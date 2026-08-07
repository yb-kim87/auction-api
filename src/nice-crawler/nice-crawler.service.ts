import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionsService } from "../auctions/auctions.service";
import { mapCrawledItem } from "../crawler/crawler-item.mapper";
import { NiceCrawlerLogRow } from "./entities/nice-crawler-log.entity";
import { NiceCrawlerPhase, NiceCrawlerStateRow } from "./entities/nice-crawler-state.entity";
import { NiceSavedSearchRow } from "./entities/nice-saved-search.entity";
import { NiceSearchConfig } from "./nice-search.types";

const STATE_ID = "singleton";
const MAX_LOGS = 500;

/** 나이스옥션 작업창 백엔드 — 탱크옥션 작업창(crawler.service.ts)과
 * 완전히 독립된 병렬 시스템(사용자 요청, 2026-08-07). 물건 저장 자체는
 * 기존 mapCrawledItem/importCrawledItem을 그대로 재사용한다 — 저장
 * 스키마는 크롤 소스와 무관하게 이미 소스 비의존적으로 설계돼 있어
 * (nice_parsers.py가 탱크와 동일한 raw 필드 형태로 변환해 보낸다),
 * 별도 저장 파이프라인을 새로 만들 필요가 없다. */
@Injectable()
export class NiceCrawlerService {
  private readonly logger = new Logger(NiceCrawlerService.name);

  constructor(
    @InjectRepository(NiceCrawlerStateRow)
    private readonly stateRepo: Repository<NiceCrawlerStateRow>,
    @InjectRepository(NiceCrawlerLogRow)
    private readonly logRepo: Repository<NiceCrawlerLogRow>,
    @InjectRepository(NiceSavedSearchRow)
    private readonly savedSearchRepo: Repository<NiceSavedSearchRow>,
    private readonly auctionsService: AuctionsService,
  ) {}

  private async getOrCreateState(): Promise<NiceCrawlerStateRow> {
    let row = await this.stateRepo.findOne({ where: { id: STATE_ID } });
    if (!row) {
      row = this.stateRepo.create({ id: STATE_ID });
      row = await this.stateRepo.save(row);
    }
    return row;
  }

  async getStatus() {
    return this.getOrCreateState();
  }

  async appendLog(level: "info" | "warn" | "error", message: string) {
    await this.logRepo.save(this.logRepo.create({ level, message }));
    const count = await this.logRepo.count();
    if (count > MAX_LOGS) {
      const excess = await this.logRepo.find({
        order: { at: "ASC" },
        take: count - MAX_LOGS,
      });
      if (excess.length) await this.logRepo.delete(excess.map((r) => r.id));
    }
    if (level === "error") this.logger.error(message);
    else if (level === "warn") this.logger.warn(message);
  }

  async getLogs(limit = 200) {
    return this.logRepo.find({ order: { at: "DESC" }, take: limit });
  }

  async clearLogs() {
    await this.logRepo.clear();
    return { ok: true };
  }

  /** 관리자가 검색조건과 함께 "시작"을 누르면 조건을 저장하고 running=true만
   * 세운다. 실제 진행(검색 API 호출 → objId 수집 → 상세 조회 → 저장)은
   * 로컬 워커가 이 플래그와 조건을 폴링해서 스스로 진행한다 — 탱크옥션
   * 작업창의 워커 폴링 패턴과 동일. */
  async start(search: NiceSearchConfig) {
    if (!search || typeof search !== "object") {
      throw new BadRequestException("검색조건이 필요합니다.");
    }
    const state = await this.getOrCreateState();
    state.running = true;
    state.phase = "collecting_objids";
    state.error = null;
    state.totalObjIds = 0;
    state.matched = 0;
    state.completed = 0;
    state.created = 0;
    state.updated = 0;
    state.skipped = 0;
    state.searchConfig = JSON.stringify(search);
    await this.stateRepo.save(state);
    await this.appendLog(
      "info",
      `나이스옥션 작업창 시작 — 최대 ${search.maxItems ?? "?"}건`,
    );
    return state;
  }

  async stop() {
    const state = await this.getOrCreateState();
    state.running = false;
    state.phase = "stopped";
    await this.stateRepo.save(state);
    await this.appendLog("info", "나이스옥션 작업창 중지");
    return state;
  }

  /** 로컬 워커가 자기 진행 상태를 주기적으로 보고한다(하트비트 겸 진행률
   * 갱신). x-crawler-secret으로 인증한다(탱크 워커 콜백과 동일 패턴). */
  async reportProgress(
    secret: string,
    patch: Partial<{
      phase: NiceCrawlerPhase;
      running: boolean;
      totalObjIds: number;
      matched: number;
      completed: number;
      lastMessage: string | null;
      error: string | null;
    }>,
  ) {
    this.requireWorkerSecret(secret);
    const state = await this.getOrCreateState();
    Object.assign(state, patch);
    await this.stateRepo.save(state);
    return state;
  }

  /** 나이스옥션에서 파싱한 물건 1건을 저장한다. mapCrawledItem이 기대하는
   * raw 필드 형태(link/auctionNo/address 등)로 워커가 이미 변환해서
   * 보낸다 — 탱크의 /crawler/import-item과 동일한 입력 계약. */
  async importItem(raw: Record<string, unknown>, secret: string) {
    this.requireWorkerSecret(secret);
    const dto = mapCrawledItem(raw);
    const label = String(dto.auctionNo || dto.address || "?").trim();
    const result = await this.auctionsService.importCrawledItem(dto, "nice-crawler");

    const state = await this.getOrCreateState();
    if (result.skipped) {
      state.skipped += 1;
      await this.stateRepo.save(state);
      const reason = (result as { reason?: string }).reason ?? "알 수 없음";
      await this.appendLog("warn", `저장 스킵 (${reason}): ${label}`);
      return result;
    }

    state.completed += 1;
    if (result.created) state.created += 1;
    else if (!result.unchanged) state.updated += 1;
    await this.stateRepo.save(state);
    await this.appendLog(
      "info",
      `${result.created ? "신규" : result.unchanged ? "변동없음" : "갱신"}: ${label}`,
    );
    return result;
  }

  async listSavedSearches() {
    const rows = await this.savedSearchRepo.find({ order: { updatedAt: "DESC" } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      search: JSON.parse(r.search) as NiceSearchConfig,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async saveSavedSearch(input: { id?: string; name: string; search: NiceSearchConfig }) {
    const name = (input.name ?? "").trim();
    if (!name) throw new BadRequestException("이름을 입력해 주세요.");
    let row: NiceSavedSearchRow | null = null;
    if (input.id) {
      row = await this.savedSearchRepo.findOne({ where: { id: input.id } });
    }
    if (!row) row = this.savedSearchRepo.create();
    row.name = name;
    row.search = JSON.stringify(input.search ?? {});
    return this.savedSearchRepo.save(row);
  }

  async deleteSavedSearch(id: string) {
    await this.savedSearchRepo.delete(id);
    return { ok: true };
  }

  private requireWorkerSecret(secret: string) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }
  }
}
