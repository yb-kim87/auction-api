import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { AuctionsService } from "../auctions/auctions.service";
import { mapCrawledItem } from "../crawler/crawler-item.mapper";
import { CourtAuctionCrawlerLogRow } from "./entities/courtauction-crawler-log.entity";
import { CourtAuctionCrawlerStateRow } from "./entities/courtauction-crawler-state.entity";
import { CourtAuctionSavedSearchRow } from "./entities/courtauction-saved-search.entity";
import { COURT_SPECIAL_COND_LABELS, CourtAuctionSearchConfig } from "./courtauction-search.types";

const execFileAsync = promisify(execFile);
const STATE_ID = "singleton";
const MAX_LOGS = 500;

export type CourtAuctionUrlEntry = { docid: string; label: string; raw: Record<string, unknown> };

/** 대법원 법원경매정보(courtauction.go.kr) 작업창 — 탱크옥션/나이스
 * 작업창(crawler.service.ts / nice-crawler.service.ts)과 완전히 독립된
 * 병렬 시스템(사용자 요청, 2026-09-03: "레이아웃을 기존 탱크옥션 작업창과
 * 동일하게 만들어두고 해당 기능들을 넣는것"). 물건 저장 자체는 기존
 * mapCrawledItem/importCrawledItem을 그대로 재사용한다(저장 스키마가
 * 크롤 소스와 무관하게 소스 비의존적으로 이미 설계돼 있음 — 나이스와
 * 동일한 이유).
 *
 * 나이스와의 차이: 나이스는 objId 목록만 먼저 모으고("주소 추가") "조회
 * 시작"에서 로컬 워커(nice_worker.py)가 상세 API까지 따로 호출한다.
 * 대법원은 2026-09-03 실측 조사 결과 **목록 API 한 번으로 이미 주소/용도/
 * 감정가/최저가/매각기일 등 화면에 필요한 핵심 필드 대부분을 받아온다**
 * (docs/history/2026-07-19_01_courtauction-httpx-exploration.md 참고) —
 * 그래서 v1은 "조회 시작" 단계에서 추가 사이트 요청이나 로컬 파이썬 워커
 * spawn을 하지 않고, collect()가 이미 받아둔 raw를 서버에서 바로 매핑해
 * 저장한다(대법원 사이트 접근 최소화 원칙 유지). 현황조사서/감정평가서
 * 서술형 텍스트, 매각물건명세서 링크 등 상세 API 전용 필드는 아직 붙이지
 * 않았다 — 그 단계에서는 나이스처럼 로컬 워커 방식으로 전환할 수 있게
 * 구조를 맞춰뒀다(runImport를 별도 프로세스로 옮기기만 하면 됨).
 */
@Injectable()
export class CourtAuctionCrawlerService {
  private readonly logger = new Logger(CourtAuctionCrawlerService.name);
  private importing = false;

  constructor(
    @InjectRepository(CourtAuctionCrawlerStateRow)
    private readonly stateRepo: Repository<CourtAuctionCrawlerStateRow>,
    @InjectRepository(CourtAuctionCrawlerLogRow)
    private readonly logRepo: Repository<CourtAuctionCrawlerLogRow>,
    @InjectRepository(CourtAuctionSavedSearchRow)
    private readonly savedSearchRepo: Repository<CourtAuctionSavedSearchRow>,
    private readonly auctionsService: AuctionsService,
  ) {}

  private async getOrCreateState(): Promise<CourtAuctionCrawlerStateRow> {
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
      const excess = await this.logRepo.find({ order: { at: "ASC" }, take: count - MAX_LOGS });
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

  private crawlerDir() {
    return join(process.cwd(), "crawler");
  }

  /** 탱크/나이스 작업창의 pythonCommand()와 동일한 탐색 순서. */
  private pythonCommand(): string {
    const configured = process.env.PYTHON_PATH?.trim();
    if (configured) return configured;
    if (process.platform === "win32") {
      const candidates = ["C:\\Python311\\python.exe", "C:\\Python312\\python.exe", "C:\\Python310\\python.exe"];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
      return "py";
    }
    return "python3";
  }

  private pythonArgs(script: string, payload: string): string[] {
    const command = this.pythonCommand();
    return command === "py" ? ["-3", script, payload] : [script, payload];
  }

  /** 탱크의 "주소 추가"/나이스의 collect()에 대응 — 검색조건으로 목록
   * API를 호출해(courtauction_collect.py) 작업목록을 만든다. 기존 목록은
   * 교체한다. */
  async collect(search: CourtAuctionSearchConfig) {
    if (!search || typeof search !== "object") {
      throw new BadRequestException("검색조건이 필요합니다.");
    }
    if (!search.cortOfcCd?.trim()) {
      throw new BadRequestException("법원을 선택해 주세요(전체 법원은 400 에러가 납니다 — 2026-09-03 실측).");
    }
    const script = join(this.crawlerDir(), "courtauction_collect.py");
    if (!existsSync(script)) {
      throw new BadRequestException("courtauction_collect.py를 찾을 수 없습니다.");
    }

    const command = this.pythonCommand();
    const args = this.pythonArgs(script, JSON.stringify(search));

    let stdout: string;
    try {
      const result = await execFileAsync(command, args, {
        cwd: this.crawlerDir(),
        timeout: 90_000,
        maxBuffer: 1024 * 1024 * 10,
      });
      stdout = result.stdout;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.appendLog("error", `대법원 수집 실패: ${message}`);
      throw new BadRequestException(`수집 실패: ${message}`);
    }

    const lastLine = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    let parsed: { items?: CourtAuctionUrlEntry[]; total?: number; error?: string };
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      await this.appendLog("error", "대법원 수집 결과 파싱 실패");
      throw new BadRequestException("수집 결과를 해석하지 못했습니다.");
    }
    if (parsed.error) {
      await this.appendLog("error", `대법원 수집 오류: ${parsed.error}`);
      throw new BadRequestException(parsed.error);
    }

    const items = parsed.items ?? [];
    const state = await this.getOrCreateState();
    state.urls = JSON.stringify(items);
    state.phase = "idle";
    await this.stateRepo.save(state);
    await this.appendLog(
      "info",
      `대법원 수집 — 검색 결과 ${(parsed.total ?? 0).toLocaleString("ko-KR")}건 중 ${items.length}건 작업목록에 담음`,
    );
    return { items, total: parsed.total ?? 0 };
  }

  /** 작업목록 편집(선택 삭제/모두 삭제) — 탱크/나이스 manageUrls와 동일한
   * 계약이지만, 원본 raw가 사람이 직접 타이핑할 만한 형태가 아니라서
   * "수동 추가"는 v1에 넣지 않았다. */
  async manageUrls(body: { action: "remove" | "clear"; indices?: number[] }) {
    const state = await this.getOrCreateState();
    let urls: CourtAuctionUrlEntry[] = state.urls ? JSON.parse(state.urls) : [];

    if (body.action === "clear") {
      urls = [];
    } else if (body.action === "remove") {
      const removeSet = new Set(body.indices ?? []);
      urls = urls.filter((_, i) => !removeSet.has(i));
    }

    state.urls = JSON.stringify(urls);
    await this.stateRepo.save(state);
    return { urls };
  }

  private formatBidDate(ymd: string): string {
    const s = String(ymd || "").trim();
    if (s.length !== 8) return "";
    return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}`;
  }

  /** 목록 API item(raw) → mapCrawledItem이 기대하는 raw 필드 형태로 변환.
   * 목록 API에서 확보 못한 필드(사건상태 텍스트, 소유자/감정인, 임차인
   * 정보, 건물등기 등 상세 API 전용 서술형 텍스트)는 빈 값으로 둔다 —
   * 억지로 추정하지 않는다(다음 단계에서 상세 API 연동 시 채울 예정). */
  private mapListItemToRaw(item: Record<string, unknown>): Record<string, unknown> {
    const str = (v: unknown) => (v == null ? "" : String(v).trim());
    const sido = str(item.hjguSido);
    const sigu = str(item.hjguSigu);
    const dong = str(item.hjguDong);
    const lotno = str(item.daepyoLotno);
    const buld = str(item.buldList);
    const address = [sido, sigu, dong, lotno].filter(Boolean).join(" ") + (buld ? ` ${buld}` : "");
    const court = [str(item.jiwonNm), str(item.jpDeptNm)].filter(Boolean).join(" ");
    const docid = str(item.docid || item.groupmaemulser);
    const specialCodes = str(item.spJogCd)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const specialNote = specialCodes.map((c) => COURT_SPECIAL_COND_LABELS[c] ?? c).join(", ");

    return {
      // 대법원은 로그인 없이 바로 열리는 물건별 고정 링크가 없다(2026-07-30
      // 조사에서 매각물건명세서 링크는 API 체인 2회 호출로만 얻을 수 있음을
      // 확인했음 — 그건 다음 단계 과제). 여기서는 중복 판정용 고유 식별자
      // 겸 내부 참조용 앵커만 만들어둔다(실제로 열리는 페이지는 아님).
      link: `https://www.courtauction.go.kr/pgj/index.on#courtauction-${docid}`,
      auctionNo: str(item.srnSaNo),
      court,
      caseState: "", // TODO: 사건상태 코드표(mulStatcd/jinstatCd) 미확보
      address,
      usage: str(item.dspslUsgNm),
      appraisedValue: item.gamevalAmt,
      minPrice: item.minmaePrice,
      bidDate: this.formatBidDate(str(item.maeGiil)),
      // 목록 API의 areaList가 이미 "715.8㎡" 형태 전용면적 텍스트를 준다
      // (2026-09-03 실측 확인 — 처음엔 표본 하나가 우연히 비어있어서 빠뜨렸었음).
      area: str(item.areaList),
      specialNote,
    };
  }

  /** "조회 시작" — v1은 collect()가 이미 받아둔 raw를 그대로 매핑해 서버
   * 프로세스 안에서 바로 저장한다(위 클래스 주석 참고). 백그라운드로
   * 돌리고(await 안 함) 즉시 state를 반환 — 탱크/나이스의 "spawn 후 바로
   * 반환" UX와 동일하게 맞춘다. */
  async start() {
    if (this.importing) {
      throw new BadRequestException("이미 처리 중입니다. 먼저 중지해 주세요.");
    }

    const state = await this.getOrCreateState();
    const urls: CourtAuctionUrlEntry[] = state.urls ? JSON.parse(state.urls) : [];
    if (urls.length === 0) {
      throw new BadRequestException("작업목록이 비어 있습니다. 먼저 검색으로 수집해 주세요.");
    }

    state.running = true;
    state.phase = "importing";
    state.error = null;
    state.matched = urls.length;
    state.completed = 0;
    state.created = 0;
    state.updated = 0;
    state.skipped = 0;
    await this.stateRepo.save(state);
    await this.appendLog("info", `대법원 작업창 시작 — 작업목록 ${urls.length}건 저장`);

    this.importing = true;
    void this.runImport(urls).finally(() => {
      this.importing = false;
    });
    return state;
  }

  private async runImport(urls: CourtAuctionUrlEntry[]) {
    for (const entry of urls) {
      const cur = await this.getOrCreateState();
      if (!cur.running) {
        await this.appendLog("info", "대법원 작업창 — 중지 요청으로 종료");
        return;
      }
      const label = entry.label || entry.docid;
      try {
        const dto = mapCrawledItem(this.mapListItemToRaw(entry.raw));
        const result = await this.auctionsService.importCrawledItem(dto, "courtauction-crawler");
        cur.completed += 1;
        if (result.skipped) {
          cur.skipped += 1;
          const reason = (result as { reason?: string }).reason ?? "알 수 없음";
          await this.appendLog("warn", `저장 스킵 (${reason}): ${label}`);
        } else {
          if (result.created) cur.created += 1;
          else if (!result.unchanged) cur.updated += 1;
          await this.appendLog(
            "info",
            `${result.created ? "신규" : result.unchanged ? "변동없음" : "갱신"}: ${label}`,
          );
        }
      } catch (err) {
        cur.completed += 1;
        cur.skipped += 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.appendLog("error", `저장 실패(${label}): ${message}`);
      }
      await this.stateRepo.save(cur);
    }

    const finalState = await this.getOrCreateState();
    finalState.running = false;
    finalState.phase = "idle";
    finalState.lastMessage = `완료 — ${finalState.completed}건 처리`;
    await this.stateRepo.save(finalState);
    await this.appendLog("info", `대법원 작업창 완료 — ${finalState.completed}건 처리`);
  }

  async stop() {
    const state = await this.getOrCreateState();
    state.running = false;
    state.phase = "stopped";
    await this.stateRepo.save(state);
    await this.appendLog("info", "대법원 작업창 중지");
    return state;
  }

  async listSavedSearches() {
    const rows = await this.savedSearchRepo.find({ order: { updatedAt: "DESC" } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      search: JSON.parse(r.search) as CourtAuctionSearchConfig,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async saveSavedSearch(input: { id?: string; name: string; search: CourtAuctionSearchConfig }) {
    const name = (input.name ?? "").trim();
    if (!name) throw new BadRequestException("이름을 입력해 주세요.");
    let row: CourtAuctionSavedSearchRow | null = null;
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
}
