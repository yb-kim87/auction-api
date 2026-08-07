import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { type ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
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
  /** 지금 실행 중인 워커 프로세스(있으면). 탱크옥션의 workerProcess와
   * 같은 역할이지만, 나이스는 상시 서버가 아니라 실행마다 새로 뜨는
   * 1회성 프로세스라 "현재 이번 실행분" 하나만 추적하면 된다. */
  private workerProcess: ChildProcess | null = null;

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

  /** 관리자가 검색조건과 함께 "시작"을 누르면 백엔드가 그 자리에서
   * 파이썬 워커 프로세스를 직접 spawn한다 — 탱크옥션 작업창
   * (crawler.service.ts의 startWorker())과 동일한 방식이다(사용자 확인,
   * 2026-08-07: "탱크옥션으로 할때는... 따로 내가 킨적은 없는거 같은데"
   * → 백엔드가 자동으로 띄우는 구조였음을 재현). 처음엔 로컬 폴링
   * 데몬(관리자가 직접 켜둬야 함)으로 만들었다가, 탱크와 동작 방식이
   * 다르다는 지적을 받고 이 방식으로 바꿨다.
   *
   * 나이스는 로그인·브라우저가 필요 없어 탱크처럼 상시 떠 있는 로컬
   * HTTP 서버(runner.py serve)를 둘 필요가 없다 — 매번 검색조건을 인자로
   * 넘겨 1회 실행하고 끝나면 프로세스가 스스로 종료되는 쪽이 더 단순하고
   * 좀비 프로세스 걱정도 없다. */
  async start(search: NiceSearchConfig) {
    if (!search || typeof search !== "object") {
      throw new BadRequestException("검색조건이 필요합니다.");
    }
    if (this.workerProcess) {
      throw new BadRequestException("이미 실행 중입니다. 먼저 중지해 주세요.");
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

    this.spawnWorker(search);
    return state;
  }

  private crawlerDir() {
    return join(process.cwd(), "crawler");
  }

  /** 탱크옥션 crawler.service.ts의 pythonCommand()와 동일한 탐색 순서 —
   * 같은 서버(Railway 컨테이너/로컬 개발 PC)에서 이미 검증된 방식이라
   * 그대로 재사용한다. */
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

  private spawnWorker(search: NiceSearchConfig) {
    const script = join(this.crawlerDir(), "nice_worker.py");
    if (!existsSync(script)) {
      void this.appendLog("error", "nice_worker.py를 찾을 수 없습니다.");
      void this.reportProgress(process.env.CRAWLER_SECRET ?? "local-crawler-secret", {
        running: false,
        phase: "error",
        error: "nice_worker.py를 찾을 수 없습니다.",
      });
      return;
    }

    const command = this.pythonCommand();
    const args = command === "py" ? ["-3", script, JSON.stringify(search)] : [script, JSON.stringify(search)];

    const proc = spawn(command, args, {
      cwd: this.crawlerDir(),
      env: {
        ...process.env,
        PRODUCTION_API_URL: process.env.PUBLIC_API_URL ?? process.env.PRODUCTION_API_URL ?? "",
        CRAWLER_SECRET: process.env.CRAWLER_SECRET ?? "local-crawler-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.workerProcess = proc;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.log(`[nice-worker] ${text}`);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.warn(`[nice-worker] ${text}`);
    });

    proc.on("exit", (code) => {
      this.workerProcess = null;
      if (code !== 0) {
        void this.appendLog("error", `나이스 워커가 비정상 종료됐습니다(code=${code}).`);
        void this.getOrCreateState().then((state) => {
          if (state.running) {
            state.running = false;
            state.phase = "error";
            state.error = `워커 프로세스 종료(code=${code})`;
            void this.stateRepo.save(state);
          }
        });
      }
    });

    proc.on("error", (err) => {
      this.workerProcess = null;
      void this.appendLog("error", `나이스 워커 실행 실패: ${err.message}`);
    });
  }

  async stop() {
    const state = await this.getOrCreateState();
    state.running = false;
    state.phase = "stopped";
    await this.stateRepo.save(state);
    if (this.workerProcess) {
      this.workerProcess.kill();
      this.workerProcess = null;
    }
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
