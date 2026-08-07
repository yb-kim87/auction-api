import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { type ChildProcess, execFile, spawn } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { join } from "path";
import { AuctionsService } from "../auctions/auctions.service";
import { mapCrawledItem } from "../crawler/crawler-item.mapper";
import { ResaleMatchService } from "../resale-match/resale-match.service";
import { NiceCrawlerLogRow } from "./entities/nice-crawler-log.entity";
import { NiceCrawlerPhase, NiceCrawlerStateRow } from "./entities/nice-crawler-state.entity";
import { NiceSavedSearchRow } from "./entities/nice-saved-search.entity";
import { NiceSearchConfig } from "./nice-search.types";

const execFileAsync = promisify(execFile);

const STATE_ID = "singleton";
const MAX_LOGS = 500;
const NICE_DETAIL_BASE = "https://niceauction.co.kr/auction/detail/";

export type NiceCrawlerUrlEntry = { objId: string; label: string };

export type NiceCrawlerResaleRunSummary = {
  totalRequested: number;
  processed: number;
  attempted: number;
  candidateFound: number;
  displayed: number;
  items: Array<{
    auctionNo: string;
    address: string;
    score: number | null;
    tier: string | null;
    displayed: boolean;
  }>;
};

/** 나이스옥션 작업창 백엔드 — 탱크옥션 작업창(crawler.service.ts)과
 * 완전히 독립된 병렬 시스템(사용자 요청, 2026-08-07). 물건 저장 자체는
 * 기존 mapCrawledItem/importCrawledItem을 그대로 재사용한다 — 저장
 * 스키마는 크롤 소스와 무관하게 이미 소스 비의존적으로 설계돼 있어
 * (nice_parsers.py가 탱크와 동일한 raw 필드 형태로 변환해 보낸다),
 * 별도 저장 파이프라인을 새로 만들 필요가 없다.
 *
 * 작업목록(URL) 스테이징 + 매도분석 연동(2026-08-07, 사용자 요청:
 * "1 2번도 일단 붙이고 테스트 해보자") — 탱크의 "주소 추가 → 조회 시작"
 * 2단계 흐름과 매도분석 체크박스/결과 집계를 그대로 재현한다.
 * "주소 추가"에 대응하는 건 collect()(nice_collect.py를 동기 실행해
 * objId 목록만 만든다), "조회 시작"에 대응하는 건 start()(현재 스테이징된
 * 목록을 nice_worker.py에 넘겨 상세조회·저장을 시킨다)다. */
@Injectable()
export class NiceCrawlerService {
  private readonly logger = new Logger(NiceCrawlerService.name);
  /** 지금 실행 중인 워커 프로세스(있으면). 탱크옥션의 workerProcess와
   * 같은 역할이지만, 나이스는 상시 서버가 아니라 실행마다 새로 뜨는
   * 1회성 프로세스라 "현재 이번 실행분" 하나만 추적하면 된다. */
  private workerProcess: ChildProcess | null = null;

  /** 이번 세션에서 진행 중인 매도분석 집계(탱크 crawler.service.ts의
   * resaleRunSummary와 동일한 패턴 — DB에 영속화하지 않는 휘발성 상태). */
  private resaleRunSummary: NiceCrawlerResaleRunSummary | null = null;

  constructor(
    @InjectRepository(NiceCrawlerStateRow)
    private readonly stateRepo: Repository<NiceCrawlerStateRow>,
    @InjectRepository(NiceCrawlerLogRow)
    private readonly logRepo: Repository<NiceCrawlerLogRow>,
    @InjectRepository(NiceSavedSearchRow)
    private readonly savedSearchRepo: Repository<NiceSavedSearchRow>,
    private readonly auctionsService: AuctionsService,
    private readonly resaleMatchService: ResaleMatchService,
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

  private niceLink(objId: string): string {
    return `${NICE_DETAIL_BASE}${objId}`;
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

  private pythonArgs(script: string, payload: string): string[] {
    const command = this.pythonCommand();
    return command === "py" ? ["-3", script, payload] : [script, payload];
  }

  /** 탱크의 "주소 추가"에 대응 — 검색조건으로 나이스 API를 뒤져 objId
   * 목록을 만들고(nice_collect.py, 동기 실행), 이미 DB에 있는 물건은
   * 제외한 뒤 작업목록으로 저장한다. 기존 목록은 교체한다(탱크의
   * clear:true 기본 동작과 동일). */
  async collect(search: NiceSearchConfig) {
    if (!search || typeof search !== "object") {
      throw new BadRequestException("검색조건이 필요합니다.");
    }
    const script = join(this.crawlerDir(), "nice_collect.py");
    if (!existsSync(script)) {
      throw new BadRequestException("nice_collect.py를 찾을 수 없습니다.");
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
      await this.appendLog("error", `나이스옥션 수집 실패: ${message}`);
      throw new BadRequestException(`수집 실패: ${message}`);
    }

    const lastLine = stdout.trim().split("\n").filter(Boolean).pop() ?? "";
    let parsed: { items?: NiceCrawlerUrlEntry[]; total?: number; error?: string };
    try {
      parsed = JSON.parse(lastLine);
    } catch {
      await this.appendLog("error", "나이스옥션 수집 결과 파싱 실패");
      throw new BadRequestException("수집 결과를 해석하지 못했습니다.");
    }
    if (parsed.error) {
      await this.appendLog("error", `나이스옥션 수집 오류: ${parsed.error}`);
      throw new BadRequestException(parsed.error);
    }

    const items = parsed.items ?? [];
    const links = items.map((i) => this.niceLink(i.objId));
    const existing = links.length ? await this.auctionsService.findByLinks(links) : [];
    const existingLinks = new Set(existing.map((a) => a.link));
    const fresh = items.filter((i) => !existingLinks.has(this.niceLink(i.objId)));
    const excluded = items.length - fresh.length;

    const state = await this.getOrCreateState();
    state.urls = JSON.stringify(fresh);
    state.totalObjIds = parsed.total ?? 0;
    state.phase = "idle";
    await this.stateRepo.save(state);
    await this.appendLog(
      "info",
      `나이스옥션 수집 — 검색 결과 ${(parsed.total ?? 0).toLocaleString("ko-KR")}건 중 ${items.length}건 확인, DB중복 ${excluded}건 제외, 작업목록 ${fresh.length}건`,
    );
    return { items: fresh, rawCount: items.length, excluded, total: parsed.total ?? 0 };
  }

  /** 작업목록(스테이징된 urls) 편집 — 탱크옥션 crawlerManageUrls와
   * 동일한 계약(add/remove/clear). add는 objId 또는 나이스 상세 링크
   * 둘 다 받는다. */
  async manageUrls(body: {
    action: "add" | "remove" | "clear";
    objId?: string;
    label?: string;
    indices?: number[];
  }) {
    const state = await this.getOrCreateState();
    let urls: NiceCrawlerUrlEntry[] = state.urls ? JSON.parse(state.urls) : [];

    if (body.action === "clear") {
      urls = [];
    } else if (body.action === "remove") {
      const removeSet = new Set(body.indices ?? []);
      urls = urls.filter((_, i) => !removeSet.has(i));
    } else if (body.action === "add") {
      const raw = (body.objId ?? "").trim();
      if (!raw) throw new BadRequestException("objId 또는 링크를 입력해 주세요.");
      const match = raw.match(/(\d{10,})/);
      const objId = match ? match[1] : raw;
      if (!urls.some((u) => u.objId === objId)) {
        urls.push({ objId, label: body.label?.trim() || objId });
      }
    }

    state.urls = JSON.stringify(urls);
    await this.stateRepo.save(state);
    return { urls };
  }

  /** 관리자가 "조회 시작"을 누르면 백엔드가 그 자리에서 파이썬 워커
   * 프로세스를 직접 spawn한다 — 탱크옥션 작업창(crawler.service.ts의
   * startWorker())과 동일한 방식이다(사용자 확인, 2026-08-07: "탱크옥션
   * 으로 할때는... 따로 내가 킨적은 없는거 같은데" → 백엔드가 자동으로
   * 띄우는 구조였음을 재현).
   *
   * 작업목록 스테이징 도입 이후, start()는 검색을 다시 하지 않고
   * collect()가 이미 만들어 둔 state.urls를 그대로 워커에 넘긴다(탱크의
   * "주소 추가 → 조회 시작" 2단계와 동일). */
  async start(options: { resaleAnalysisEnabled?: boolean } = {}) {
    if (this.workerProcess) {
      throw new BadRequestException("이미 실행 중입니다. 먼저 중지해 주세요.");
    }

    const state = await this.getOrCreateState();
    const urls: NiceCrawlerUrlEntry[] = state.urls ? JSON.parse(state.urls) : [];
    if (urls.length === 0) {
      throw new BadRequestException("작업목록이 비어 있습니다. 먼저 검색으로 수집해 주세요.");
    }

    state.running = true;
    state.phase = "fetching_details";
    state.error = null;
    state.matched = urls.length;
    state.completed = 0;
    state.created = 0;
    state.updated = 0;
    state.skipped = 0;
    state.resaleAnalysisEnabled = Boolean(options.resaleAnalysisEnabled);
    await this.stateRepo.save(state);

    if (options.resaleAnalysisEnabled) {
      if (this.resaleRunSummary && this.resaleRunSummary.processed < this.resaleRunSummary.totalRequested) {
        this.resaleRunSummary.totalRequested += urls.length;
      } else {
        this.resaleRunSummary = {
          totalRequested: urls.length,
          processed: 0,
          attempted: 0,
          candidateFound: 0,
          displayed: 0,
          items: [],
        };
      }
    }

    await this.appendLog("info", `나이스옥션 작업창 시작 — 작업목록 ${urls.length}건 처리`);
    this.spawnWorker(urls.map((u) => u.objId));
    return state;
  }

  private spawnWorker(objIds: string[]) {
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
    const args = this.pythonArgs(script, JSON.stringify(objIds));

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
      this.markResaleProcessed();
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

    // 저장 직후 바로 국토부 실거래가 매도분석을 시도한다(탱크
    // crawler.service.ts의 동일 패턴 — 완납일이 없거나 조건 미충족이면
    // resaleMatchService 내부에서 조용히 스킵된다). 조회 흐름을 막지
    // 않도록 await하지 않는다.
    if (result.item) {
      const item = result.item;
      void this.resaleMatchService
        .processAuctionForResale(item)
        .then((outcome) => this.recordResaleOutcome(item, outcome))
        .catch(() => this.markResaleProcessed());
    } else {
      this.markResaleProcessed();
    }

    return result;
  }

  private recordResaleOutcome(
    auction: { auctionNo: string; address: string },
    result: { attempted: boolean; candidateFound: boolean; displayed: boolean; score: number | null; tier: string | null },
  ): void {
    if (this.resaleRunSummary && result.attempted) {
      this.resaleRunSummary.attempted += 1;
      if (result.candidateFound) this.resaleRunSummary.candidateFound += 1;
      if (result.displayed) this.resaleRunSummary.displayed += 1;
      this.resaleRunSummary.items.push({
        auctionNo: auction.auctionNo,
        address: auction.address,
        score: result.score,
        tier: result.tier,
        displayed: result.displayed,
      });
    }
    this.markResaleProcessed();
  }

  private markResaleProcessed(): void {
    if (!this.resaleRunSummary) return;
    this.resaleRunSummary.processed += 1;
    const { processed, totalRequested, attempted, candidateFound, displayed } = this.resaleRunSummary;
    if (processed >= totalRequested) {
      void this.appendLog(
        "info",
        `[매도분석] 전체 완료(${totalRequested}건 검토, 분석시도 ${attempted}건) — 매도 건수는 ${displayed}건입니다(QA 후보 포함 ${candidateFound}건)`,
      );
    }
  }

  getResaleRunSummary() {
    return this.resaleRunSummary;
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
