import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { execSync, spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import * as http from "http";
import * as https from "https";
import { AuctionsService } from "../auctions/auctions.service";
import { CafeKnowledgeService } from "../ai/cafe-knowledge.service";
import type { KnowledgeDraftStatus } from "../ai/knowledge-draft.entity";
import { KnowledgeService } from "../ai/knowledge.service";
import {
  loadCrawlerConfig,
  saveCrawlerConfig,
} from "./crawler-config.store";
import {
  buildAlgorithmTelegramMessage,
  checkAlgorithmMatch,
  CrawlerTelegramService,
} from "./crawler-algorithm.service";
import { mapCrawledItem } from "./crawler-item.mapper";
import { filterCollectedUrls } from "./crawler-url.util";
import { randomUUID } from "crypto";
import type {
  CollectUrlsDto,
  CrawlerConfig,
  CrawlerLogEntry,
  CrawlerLoginDto,
  CrawlerSearchConfig,
  CrawlerStatus,
  CrawlerUrlEntry,
  ManageUrlsDto,
  SavedSearchPreset,
  SaveSearchPresetDto,
  StartCrawlDto,
} from "./crawler.types";
import { TODAY_BID_DATE_PRESET_ID } from "./crawler.types";

const DEFAULT_WORKER_PORT = Number(process.env.CRAWLER_WORKER_PORT ?? 8765);
const WORKER_START_TIMEOUT_MS = 30_000;
const REMOTE_WORKER_OFFLINE_MESSAGE =
  "관리자 PC가 꺼져 있거나 크롤러 워커에 연결할 수 없습니다. PC에서 auction-api(npm run start:dev)와 크롤러 터널을 실행한 뒤 다시 시도해 주세요.";

// Node 24 undici의 AbortSignal.timeout()은 로컬 fetch가 빈번할 때
// 내부 타이머/소켓 정리 경합으로 AssertionError를 유발할 수 있어(관리자
// 화면의 /status 폴링에서 재현됨), 수동 AbortController로 대체한다.
function abortTimeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (typeof timer.unref === "function") timer.unref();
  return controller.signal;
}

interface SimpleResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

// Node 24 undici(fetch)의 소켓 종료 처리 버그(AssertionError: false == true,
// Parser.finish/Socket.onHttpSocketEnd)가 크롤러 워커와의 빈번한 로컬 통신에서
// 프로세스를 통째로 죽인다. 이 워커 통신 경로에서만 undici를 완전히 우회하고
// Node 내장 http/https 모듈로 직접 요청한다.
function nodeHttpFetch(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<SimpleResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const headers = { ...init.headers };
    // Content-Length가 없으면 Node가 chunked 인코딩으로 보내는데, 파이썬
    // http.server(BaseHTTPRequestHandler)는 Content-Length만 보고 바디
    // 길이를 읽으므로(청크 디코딩 미지원) 바디가 통째로 무시된다.
    if (init.body != null) {
      headers["Content-Length"] = String(Buffer.byteLength(init.body));
    }
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: init.method ?? "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          const bodyText = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: status >= 200 && status < 300,
            status,
            json: async () => (bodyText ? JSON.parse(bodyText) : {}),
          });
        });
      },
    );
    req.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) {
        req.destroy(new Error("aborted"));
      } else {
        init.signal.addEventListener("abort", () => req.destroy(new Error("aborted")));
      }
    }
    if (init.body) req.write(init.body);
    req.end();
  });
}

@Injectable()
export class CrawlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlerService.name);
  private workerProcess: ChildProcess | null = null;
  private workerStarting: Promise<void> | null = null;
  private workerCallbackKey = "";
  private readonly logs: CrawlerLogEntry[] = [];
  private readonly maxLogs = 500;
  private localStatus: CrawlerStatus = this.defaultStatus();
  private config: CrawlerConfig = loadCrawlerConfig();
  private lastScheduledDate = "";
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private jobRunning = false;

  constructor(
    private readonly auctionsService: AuctionsService,
    private readonly telegramService: CrawlerTelegramService,
    private readonly cafeKnowledgeService: CafeKnowledgeService,
    private readonly knowledgeService: KnowledgeService,
  ) {
    const dataDir = join(process.cwd(), "data", "crawler");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.applyScheduleToStatus();
    this.migrateLegacyPresetsToSavedSearches();
  }

  // 기존 고정 프리셋(아파트/다가구/빌라/공매)을 없애고 전부 "관심조건"
  // (SavedSearchPreset)으로 통합하면서, 이미 이 이름을 참조하고 있을 수
  // 있는 예약 스케줄러(schedule.preset)가 계속 동작하도록 서버 기동 시
  // 1회 자동 등록한다. 이미 등록되어 있으면(재기동 등) 건드리지 않는다.
  private migrateLegacyPresetsToSavedSearches() {
    const existingNames = new Set(
      (this.config.savedSearches ?? []).map((item) => item.name),
    );
    const legacyPresets = ["아파트", "다가구", "빌라", "공매"];
    const missing = legacyPresets.filter((name) => !existingNames.has(name));
    if (missing.length === 0) return;

    const now = new Date().toISOString();
    const created = missing.map((name) => ({
      id: randomUUID(),
      name,
      search: this.resolveSearchConfig(name),
      createdAt: now,
      updatedAt: now,
    }));
    this.config = {
      ...this.config,
      savedSearches: [...(this.config.savedSearches ?? []), ...created],
    };
    saveCrawlerConfig(this.config);
  }

  onModuleInit() {
    this.schedulerTimer = setInterval(() => {
      void this.tickScheduler();
    }, 60_000);
  }

  onModuleDestroy() {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
    if (!this.isRemoteWorkerMode()) {
      void this.stopWorker();
    }
  }

  getConfig(): CrawlerConfig {
    this.config = loadCrawlerConfig();
    return structuredClone(this.config);
  }

  updateConfig(partial: Partial<CrawlerConfig>): CrawlerConfig {
    this.config = loadCrawlerConfig();
    const prevSchedule = this.config.schedule;
    const nextSchedule = {
      ...prevSchedule,
      ...partial.schedule,
    };
    if (
      partial.schedule?.enabled === true &&
      !prevSchedule.enabled
    ) {
      nextSchedule.oneTimeCompleted = false;
    }
    if (
      partial.schedule?.repeatDaily === false &&
      prevSchedule.repeatDaily &&
      nextSchedule.enabled
    ) {
      nextSchedule.oneTimeCompleted = false;
    }
    this.config = {
      search: { ...this.config.search, ...partial.search },
      algorithm: { ...this.config.algorithm, ...partial.algorithm },
      schedule: nextSchedule,
      credentials: { ...this.config.credentials, ...partial.credentials },
      naverCredentials: {
        ...this.config.naverCredentials,
        ...partial.naverCredentials,
      },
      savedSearches: partial.savedSearches ?? this.config.savedSearches,
    };
    saveCrawlerConfig(this.config);
    this.applyScheduleToStatus();
    return structuredClone(this.config);
  }

  private applyScheduleToStatus() {
    this.localStatus.scheduledTime = this.config.schedule.time;
    this.localStatus.scheduleEnabled = this.config.schedule.enabled;
    this.localStatus.scheduleRepeatDaily = this.config.schedule.repeatDaily;
    this.localStatus.excludeDuplicates = this.config.schedule.excludeDuplicates;
  }

  private defaultStatus(): CrawlerStatus {
    return {
      workerRunning: false,
      browserReady: false,
      phase: "idle",
      preset: "현재",
      urls: [],
      completed: 0,
      total: 0,
      created: 0,
      updated: 0,
      repeatAfterCollect: false,
      scheduledTime: null,
      scheduleEnabled: false,
      scheduleRepeatDaily: true,
      excludeDuplicates: false,
      error: null,
      lastMessage: null,
    };
  }

  private appendLog(level: CrawlerLogEntry["level"], message: string) {
    this.logs.push({
      at: new Date().toISOString(),
      level,
      message,
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.splice(0, this.logs.length - this.maxLogs);
    }
  }

  getLogs(limit = 200): CrawlerLogEntry[] {
    return this.logs.slice(-limit);
  }

  clearLogs() {
    this.logs.length = 0;
  }

  appendWorkerLog(level: CrawlerLogEntry["level"], message: string) {
    this.appendLog(level, message);
  }

  async getStatus(): Promise<CrawlerStatus> {
    await this.syncWorkerStatus();
    this.applyScheduleToStatus();
    const status: CrawlerStatus = {
      ...this.localStatus,
      remoteWorker: this.isRemoteWorkerMode(),
    };
    if (status.remoteWorker && !status.workerRunning) {
      status.error = REMOTE_WORKER_OFFLINE_MESSAGE;
    }
    return status;
  }

  private workerPort(): number {
    const configured = process.env.CRAWLER_WORKER_URL?.trim();
    if (configured) {
      try {
        const parsed = Number(new URL(configured).port);
        if (parsed > 0) return parsed;
      } catch {
        // ignore invalid URL
      }
    }
    return DEFAULT_WORKER_PORT;
  }

  private workerBaseUrl(): string {
    const configured = process.env.CRAWLER_WORKER_URL?.trim();
    if (configured) {
      return configured.replace(/\/$/, "");
    }
    return `http://127.0.0.1:${this.workerPort()}`;
  }

  private isRemoteWorkerMode(): boolean {
    const configured = process.env.CRAWLER_WORKER_URL?.trim();
    if (!configured) return false;
    try {
      const host = new URL(configured).hostname.toLowerCase();
      return host !== "127.0.0.1" && host !== "localhost";
    } catch {
      return !/^(https?:\/\/)?(127\.0\.0\.1|localhost)/i.test(configured);
    }
  }

  private workerAuthHeaders(): Record<string, string> {
    const secret = process.env.CRAWLER_WORKER_SECRET?.trim();
    if (!secret) return {};
    return { "X-Crawler-Worker-Secret": secret };
  }

  private workerUnavailableMessage(): string {
    return REMOTE_WORKER_OFFLINE_MESSAGE;
  }

  private isWorkerConnectionError(message: string): boolean {
    const lower = message.toLowerCase();
    return (
      lower.includes("econnrefused") ||
      lower.includes("enotfound") ||
      lower.includes("etimedout") ||
      lower.includes("fetch failed") ||
      lower.includes("network") ||
      lower.includes("abort") ||
      lower.includes("socket")
    );
  }

  private crawlerDir() {
    return join(process.cwd(), "crawler");
  }

  private pythonCommand(): string {
    const configured = process.env.PYTHON_PATH?.trim();
    if (configured) return configured;

    if (process.platform === "win32") {
      const candidates = [
        "C:\\Python311\\python.exe",
        "C:\\Python312\\python.exe",
        "C:\\Python310\\python.exe",
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
      return "py";
    }

    return "python";
  }

  private pythonSpawnArgs(runner: string): string[] {
    const command = this.pythonCommand();
    if (command === "py") {
      return ["-3", runner, "serve"];
    }
    return [runner, "serve"];
  }

  private isLocalCallback(url: string) {
    return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url.trim());
  }

  private primaryCallbackConfig() {
    if (this.isRemoteWorkerMode()) {
      const publicUrl =
        process.env.PUBLIC_API_URL?.trim() ||
        process.env.PRODUCTION_API_URL?.trim();
      if (publicUrl) {
        return {
          callbackUrl: `${publicUrl.replace(/\/$/, "")}/crawler/import-item`,
          callbackSecret: process.env.CRAWLER_SECRET ?? "local-crawler-secret",
        };
      }
    }
    return {
      callbackUrl: `http://127.0.0.1:${process.env.PORT ?? 3001}/crawler/import-item`,
      callbackSecret: process.env.CRAWLER_SECRET ?? "local-crawler-secret",
    };
  }

  private cafeCallbackConfig() {
    const base = this.primaryCallbackConfig();
    return {
      callbackUrl: base.callbackUrl.replace(
        /\/import-item$/,
        "/import-cafe-post",
      ),
      callbackSecret: base.callbackSecret,
    };
  }

  private mirrorCallbackConfig(): {
    callbackUrl: string;
    callbackSecret: string;
  } | null {
    const mirror =
      process.env.CRAWLER_MIRROR_URL?.trim() ||
      process.env.CRAWLER_CALLBACK_URL?.trim();
    if (!mirror || this.isLocalCallback(mirror)) {
      return null;
    }
    const primary = this.primaryCallbackConfig().callbackUrl;
    if (mirror.replace(/\/$/, "") === primary.replace(/\/$/, "")) {
      return null;
    }
    return {
      callbackUrl: mirror,
      callbackSecret: process.env.CRAWLER_SECRET ?? "local-crawler-secret",
    };
  }

  private callbackConfig() {
    return this.primaryCallbackConfig();
  }

  private dualWriteConfig() {
    const primary = this.primaryCallbackConfig();
    const mirror = this.mirrorCallbackConfig();
    return {
      ...primary,
      mirrorCallbackUrl: mirror?.callbackUrl ?? null,
      mirrorCallbackSecret: mirror?.callbackSecret ?? null,
    };
  }

  private workerEnv() {
    const { callbackUrl, callbackSecret, mirrorCallbackUrl } =
      this.dualWriteConfig();
    return {
      ...process.env,
      CRAWLER_WORKER_PORT: String(this.workerPort()),
      CRAWLER_WORKER_SECRET: process.env.CRAWLER_WORKER_SECRET ?? "",
      TANK_AUCTION_USER: process.env.TANK_AUCTION_USER ?? "",
      TANK_AUCTION_PASSWORD: process.env.TANK_AUCTION_PASSWORD ?? "",
      CRAWLER_CALLBACK_URL: callbackUrl,
      CRAWLER_MIRROR_URL: mirrorCallbackUrl ?? "",
      CRAWLER_SECRET: callbackSecret,
    };
  }

  private async workerFetch<T>(
    path: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<T> {
    try {
      const res = await nodeHttpFetch(`${this.workerBaseUrl()}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...this.workerAuthHeaders(),
          ...(init?.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("크롤러 워커 인증 실패 (CRAWLER_WORKER_SECRET 확인)");
        }
        throw new Error(
          typeof data.error === "string"
            ? data.error
            : `워커 요청 실패 (${res.status})`,
        );
      }
      return data as T;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "크롤러 워커 통신 오류";
      if (
        this.isRemoteWorkerMode() &&
        this.isWorkerConnectionError(message)
      ) {
        throw new ServiceUnavailableException(this.workerUnavailableMessage());
      }
      throw new ServiceUnavailableException(message);
    }
  }

  private async isWorkerHealthy(): Promise<boolean> {
    try {
      const res = await nodeHttpFetch(`${this.workerBaseUrl()}/health`, {
        signal: abortTimeoutSignal(this.isRemoteWorkerMode() ? 5000 : 1500),
      });
      if (!res.ok) return false;

      if (this.jobRunning) return true;

      const secret = process.env.CRAWLER_WORKER_SECRET?.trim();
      if (!secret || this.isRemoteWorkerMode()) return true;

      const statusRes = await nodeHttpFetch(`${this.workerBaseUrl()}/status`, {
        signal: abortTimeoutSignal(3000),
        headers: this.workerAuthHeaders(),
      });
      return statusRes.ok;
    } catch {
      return false;
    }
  }

  private forceKillLocalWorkerPort(): void {
    if (this.isRemoteWorkerMode() || process.platform !== "win32") return;
    try {
      execSync(
        `powershell -NoProfile -Command "$p=(Get-NetTCPConnection -LocalPort ${this.workerPort()} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess; if ($p) { Stop-Process -Id $p -Force }"`,
        { stdio: "ignore" },
      );
    } catch {
      // ignore
    }
  }

  private async ensureRemoteWorker(): Promise<void> {
    if (await this.isWorkerHealthy()) {
      this.localStatus.workerRunning = true;
      const { callbackUrl, callbackSecret, mirrorCallbackUrl } =
        this.dualWriteConfig();
      this.workerCallbackKey = `${callbackUrl}|${callbackSecret}|${mirrorCallbackUrl ?? ""}`;
      return;
    }
    this.localStatus.workerRunning = false;
    this.localStatus.browserReady = false;
    throw new ServiceUnavailableException(this.workerUnavailableMessage());
  }

  private async ensureWorker(): Promise<void> {
    if (this.isRemoteWorkerMode()) {
      await this.ensureRemoteWorker();
      return;
    }

    const { callbackUrl, callbackSecret, mirrorCallbackUrl } =
      this.dualWriteConfig();
    const callbackKey = `${callbackUrl}|${callbackSecret}|${mirrorCallbackUrl ?? ""}`;

    if (await this.isWorkerHealthy()) {
      if (this.workerCallbackKey && this.workerCallbackKey !== callbackKey) {
        this.appendLog(
          "info",
          "크롤러 콜백 설정이 변경되어 워커를 재시작합니다.",
        );
        await this.stopWorker();
      } else {
        this.localStatus.workerRunning = true;
        this.workerCallbackKey = callbackKey;
        return;
      }
    } else if (!this.isRemoteWorkerMode()) {
      const healthOnly = await nodeHttpFetch(`${this.workerBaseUrl()}/health`, {
        signal: abortTimeoutSignal(1500),
      }).then((res) => res.ok).catch(() => false);
      if (healthOnly) {
        this.appendLog(
          "warn",
          "워커 인증 키가 API와 다릅니다. 기존 워커를 종료하고 다시 시작합니다.",
        );
        this.forceKillLocalWorkerPort();
        this.workerProcess = null;
        this.localStatus.workerRunning = false;
      }
    }

    if (this.workerStarting) {
      await this.workerStarting;
      return;
    }

    this.workerStarting = this.startWorker();
    try {
      await this.workerStarting;
    } finally {
      this.workerStarting = null;
    }
  }

  private async startWorker(): Promise<void> {
    const { callbackUrl, callbackSecret, mirrorCallbackUrl } =
      this.dualWriteConfig();
    const callbackKey = `${callbackUrl}|${callbackSecret}|${mirrorCallbackUrl ?? ""}`;

    const runner = join(this.crawlerDir(), "runner.py");
    if (!existsSync(runner)) {
      throw new ServiceUnavailableException(
        "Python 크롤러(runner.py)를 찾을 수 없습니다.",
      );
    }

    this.appendLog("info", "크롤러 워커를 시작합니다...");
    this.localStatus.phase = "starting";

    const proc = spawn(
      this.pythonCommand(),
      this.pythonSpawnArgs(runner),
      {
        cwd: this.crawlerDir(),
        env: this.workerEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    this.workerProcess = proc;

    proc.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.log(`[crawler-worker] ${text}`);
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (!text) return;
      if (
        text.includes("ConnectionAbortedError") ||
        text.includes("WinError 10053") ||
        text.includes("BrokenPipeError")
      ) {
        return;
      }
      this.logger.warn(`[crawler-worker] ${text}`);
      if (
        text.includes("Stacktrace:") &&
        text.includes("undetected_chromedriver")
      ) {
        this.appendLog(
          "warn",
          "Chrome 드라이버 오류 — 「워커 재시작」 후 탱크옥션 로그인을 다시 시도해 주세요.",
        );
        return;
      }
      this.appendLog("warn", text);
    });

    proc.on("exit", (code) => {
      this.workerProcess = null;
      this.localStatus.workerRunning = false;
      this.localStatus.browserReady = false;
      if (code !== 0 && code !== null) {
        this.localStatus.phase = "error";
        this.localStatus.error = `워커가 종료되었습니다 (code ${code})`;
        this.appendLog("error", this.localStatus.error);
      }
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < WORKER_START_TIMEOUT_MS) {
      if (await this.isWorkerHealthy()) {
        this.localStatus.workerRunning = true;
        this.localStatus.phase = "idle";
        this.workerCallbackKey = callbackKey;
        this.appendLog("info", "크롤러 워커가 준비되었습니다.");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new ServiceUnavailableException(
      "크롤러 워커 시작 시간이 초과되었습니다. Python/Selenium 설치를 확인해 주세요.",
    );
  }

  async stopWorker() {
    if (this.isRemoteWorkerMode()) {
      this.localStatus.workerRunning = false;
      this.localStatus.browserReady = false;
      this.localStatus.phase = "idle";
      return;
    }

    if (await this.isWorkerHealthy()) {
      try {
        await this.workerFetch("/shutdown", { method: "POST", body: "{}" });
      } catch {
        this.forceKillLocalWorkerPort();
      }
    } else {
      this.forceKillLocalWorkerPort();
    }
    if (this.workerProcess) {
      this.workerProcess.kill();
      this.workerProcess = null;
    }
    this.localStatus.workerRunning = false;
    this.localStatus.browserReady = false;
    this.localStatus.phase = "idle";
  }

  private mergeWorkerStatus(remote: Partial<CrawlerStatus>) {
    if (this.isRemoteWorkerMode()) {
      this.localStatus = {
        ...this.localStatus,
        ...remote,
        workerRunning: true,
      };
      return;
    }

    // created/updated 뿐 아니라 total 도 워커(server_v3.py) 응답을
    // 그대로 신뢰하면 안 된다 — v3 워커는 목록 수집(/collect-urls-v3)
    // 단계에서는 STATE.total 을 전혀 갱신하지 않고 조회 시작
    // (/crawl/start-v3) 단계에서만 값을 채우므로, collectUrls() 가
    // 방금 세팅한 정확한 total(수집된 URL 개수)을 다음 /status 폴링이
    // 곧바로 0으로 덮어써 "총 작업 개수"가 사라지는 버그가 있었다
    // (2026-07-17 실측). phase가 collecting/idle 일 때는 로컬 total을
    // 유지하고, crawling 단계에서만 워커의 total(진행 중 조회 대상
    // 개수)을 신뢰한다.
    const { created: _c, updated: _u, total: remoteTotal, ...rest } = remote;
    const shouldTrustRemoteTotal =
      remote.phase === "crawling" || remote.phase === "stopped";
    this.localStatus = {
      ...this.localStatus,
      ...rest,
      total: shouldTrustRemoteTotal ? (remoteTotal ?? this.localStatus.total) : this.localStatus.total,
      workerRunning: true,
    };
  }

  private async syncWorkerStatus() {
    if (!(await this.isWorkerHealthy())) {
      if (!this.jobRunning) {
        this.localStatus.workerRunning = false;
        this.localStatus.browserReady = false;
        if (this.localStatus.phase !== "error") {
          this.localStatus.phase = "idle";
        }
      }
      return;
    }

    try {
      const remote = await this.workerFetch<
        Partial<CrawlerStatus> & { events?: string[] }
      >("/status", {
        signal: abortTimeoutSignal(this.jobRunning ? 2500 : 5000),
      });
      if (remote.events?.length) {
        for (const message of remote.events) {
          const level: CrawlerLogEntry["level"] = message.includes("오류")
            ? "error"
            : "info";
          this.appendLog(level, message);
        }
      }
      this.mergeWorkerStatus(remote);
      if (remote.phase === "idle" || remote.phase === "stopped" || remote.phase === "error") {
        this.jobRunning = false;
      }
    } catch {
      if (!this.jobRunning) {
        this.localStatus.workerRunning = false;
      }
    }
  }

  listSavedSearches(): SavedSearchPreset[] {
    this.config = loadCrawlerConfig();
    return this.config.savedSearches ?? [];
  }

  saveSavedSearch(dto: SaveSearchPresetDto): SavedSearchPreset {
    this.config = loadCrawlerConfig();
    const now = new Date().toISOString();
    const list = [...(this.config.savedSearches ?? [])];

    if (dto.id) {
      const index = list.findIndex((item) => item.id === dto.id);
      if (index >= 0) {
        const updated: SavedSearchPreset = {
          ...list[index],
          name: dto.name,
          search: dto.search,
          updatedAt: now,
        };
        list[index] = updated;
        this.config = { ...this.config, savedSearches: list };
        saveCrawlerConfig(this.config);
        return updated;
      }
    }

    const created: SavedSearchPreset = {
      id: randomUUID(),
      name: dto.name,
      search: dto.search,
      createdAt: now,
      updatedAt: now,
    };
    list.push(created);
    this.config = { ...this.config, savedSearches: list };
    saveCrawlerConfig(this.config);
    return created;
  }

  deleteSavedSearch(id: string): { ok: boolean } {
    this.config = loadCrawlerConfig();
    const list = (this.config.savedSearches ?? []).filter(
      (item) => item.id !== id,
    );
    this.config = { ...this.config, savedSearches: list };
    saveCrawlerConfig(this.config);
    return { ok: true };
  }

  private resolveSearchConfig(preset: string, override?: CollectUrlsDto["search"]) {
    this.config = loadCrawlerConfig();
    const base = { ...this.config.search, ...override };

    if (preset === "아파트") {
      return {
        ...base,
        listType: "auction" as const,
        propertyTypes: ["아파트"],
        status: "진행물건",
      };
    }
    if (preset === "공매") {
      return {
        ...base,
        listType: "public" as const,
        propertyTypes: ["다가구주택", "상가주택"],
        status: "기타",
      };
    }
    if (preset === "다가구") {
      return {
        ...base,
        listType: "auction" as const,
        propertyTypes: ["다가구주택", "상가주택"],
        status: "진행물건",
      };
    }
    if (preset === "빌라") {
      return {
        ...base,
        listType: "auction" as const,
        propertyTypes: base.propertyTypes?.length
          ? base.propertyTypes
          : ["연립주택", "다세대주택", "도시형생활주택"],
        status: base.status || "진행물건",
      };
    }

    return base;
  }

  async login(submittedBy: string, dto: CrawlerLoginDto = {}) {
    try {
      return await this.loginOnce(submittedBy, dto);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (
        message.includes("WinError 193") ||
        message.includes("invalid session id") ||
        message.includes("InvalidSessionId") ||
        message.includes("Win32") ||
        message.includes("ChromeDriver")
      ) {
        this.appendLog("warn", "워커를 재시작한 뒤 로그인을 다시 시도합니다.");
        await this.stopWorker();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return this.loginOnce(submittedBy, dto);
      }
      throw error;
    }
  }

  private resolveCredentials(dto: CrawlerLoginDto) {
    this.config = loadCrawlerConfig();
    const userId =
      dto.userId?.trim() ||
      this.config.credentials.userId ||
      "zgamez";
    const password =
      dto.password ||
      this.config.credentials.password ||
      "young1!";
    return { userId, password };
  }

  private async loginOnce(submittedBy: string, dto: CrawlerLoginDto = {}) {
    const credentials = this.resolveCredentials(dto);

    if (!credentials.userId || !credentials.password) {
      throw new ServiceUnavailableException(
        "탱크옥션 ID와 비밀번호를 입력해 주세요.",
      );
    }

    this.updateConfig({
      credentials: {
        userId: credentials.userId,
        password: credentials.password,
      },
    });

    await this.ensureWorker();
    this.appendLog("info", `${submittedBy}님이 탱크옥션 로그인을 요청했습니다.`);
    const result = await this.workerFetch<{ ok: boolean; message?: string }>(
      "/login",
      {
        method: "POST",
        body: JSON.stringify({
          userId: credentials.userId,
          password: credentials.password,
        }),
      },
    );
    if (result.message) this.appendLog("info", result.message);
    await this.syncWorkerStatus();
    return result;
  }

  private crawlerCredentialBody() {
    const credentials = this.resolveCredentials({});
    return {
      userId: credentials.userId,
      password: credentials.password,
    };
  }

  private markLoginFailure(message: string) {
    this.localStatus.phase = "error";
    this.localStatus.error = message;
    this.localStatus.lastMessage = message;
    this.jobRunning = false;
    this.appendLog("error", message);
  }

  private async ensureCrawlerLoggedIn(
    submittedBy: string,
    retried = false,
    options: { strict?: boolean } = {},
  ) {
    const strict = options.strict ?? true;
    try {
      await this.ensureWorker();
      const credentials = this.resolveCredentials({});
      const session = await this.workerFetch<{
        browserReady: boolean;
        loggedIn: boolean;
      }>("/session");

      if (session.loggedIn) return;

      this.appendLog(
        "info",
        `${submittedBy}: 탱크옥션 로그인이 풀렸습니다 — 저장된 계정으로 자동 로그인합니다.`,
      );

      await this.workerFetch<{ ok: boolean; message?: string; loggedIn?: boolean }>(
        "/ensure-login",
        {
          method: "POST",
          body: JSON.stringify({
            userId: credentials.userId,
            password: credentials.password,
          }),
        },
      );

      const after = await this.workerFetch<{
        browserReady: boolean;
        loggedIn: boolean;
      }>("/session");
      if (!after.loggedIn) {
        const message =
          "탱크옥션 로그인에 실패했습니다. ID/비밀번호를 확인한 뒤 다시 시도해 주세요.";
        this.markLoginFailure(message);
        if (strict) {
          throw new ServiceUnavailableException(message);
        }
        return;
      }

      this.appendLog("info", "탱크옥션 자동 로그인 완료");
      await this.syncWorkerStatus();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      if (
        !retried &&
        (message.includes("WinError 193") ||
          message.includes("invalid session id") ||
          message.includes("InvalidSessionId") ||
          message.includes("Win32") ||
          message.includes("ChromeDriver"))
      ) {
        this.appendLog("warn", "워커를 재시작한 뒤 자동 로그인을 다시 시도합니다.");
        await this.stopWorker();
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this.ensureCrawlerLoggedIn(submittedBy, true, options);
        return;
      }
      if (strict) {
        this.markLoginFailure(message);
        throw error instanceof ServiceUnavailableException
          ? error
          : new ServiceUnavailableException(message);
      }
      this.appendLog(
        "warn",
        `${submittedBy}: 자동 로그인에 실패했습니다. (${message})`,
      );
    }
  }

  // v3(완전 HTTPX)는 요청마다 자체적으로 로그인하고 세션을 남기지 않는
  // 무상태 구조라, v1처럼 "로그인 상태 유지"라는 개념이 없다. 대신 관리자
  // 화면에서 미리 자격증명이 유효한지 1회 확인시켜 즐겨찾기 조회·주소
  // 추가 버튼을 활성화하는 게이트로 쓴다.
  async checkTankLoginV3(submittedBy: string) {
    await this.ensureWorker();
    this.appendLog("info", `${submittedBy}님이 탱크옥션 로그인을 확인합니다.`);
    try {
      await this.workerFetch<{ ok: boolean }>("/tank-login-check", {
        method: "POST",
        body: "{}",
      });
      this.appendLog("info", "탱크옥션 로그인 확인 완료.");
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "로그인 확인 실패";
      this.appendLog("error", `탱크옥션 로그인 확인 실패: ${message}`);
      throw error;
    }
  }

  async listTankFavoriteSearches(submittedBy: string) {
    await this.ensureWorker();
    this.appendLog(
      "info",
      `${submittedBy}님이 탱크옥션 즐겨쓰는 검색 목록을 불러옵니다.`,
    );
    try {
      const result = await this.workerFetch<{
        ok: boolean;
        items: unknown[];
      }>("/tank-favorite-searches", { method: "GET" });
      this.appendLog(
        "info",
        `탱크옥션 즐겨쓰는 검색 ${result.items?.length ?? 0}건을 불러왔습니다.`,
      );
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "즐겨쓰는 검색 조회 실패";
      this.appendLog("error", `즐겨쓰는 검색 조회 실패: ${message}`);
      throw error;
    }
  }

  // v3(완전 HTTPX)는 브라우저 화면이 없어 "현재 화면 상태"라는 개념
  // 자체가 성립하지 않는다 — 관리자 화면(CrawlerSearchPanel)이 필드별로
  // 빈 값(조건 없음)이거나 채운 값인 완전한 CrawlerSearchConfig 를 항상
  // dto.search로 보낸다. v1의 "현재" 프리셋(관리자 기본 검색조건과
  // 병합)과는 절대 섞지 않는다 — 섞으면 즐겨찾기 원본에 없던 필드에
  // 관리자 기본값이 끼어들어 검색 조건이 의도치 않게 좁아진다(실측:
  // 32건→1건, 2026-07-17). 빈 값인 필드는 build_query_from_search_config
  // (Python)가 "조건 없음"으로 처리하므로, dto.search 자체가 없을 때만
  // (관리자 화면 버그 등 비정상 호출) 방어적으로 막는다.
  async countSearchResultsV3(search?: CrawlerSearchConfig) {
    if (!search) {
      throw new ServiceUnavailableException(
        "건수를 확인할 검색조건이 없습니다.",
      );
    }
    await this.ensureWorker();
    return this.workerFetch<{ ok: boolean; total: number }>(
      "/count-search-v3",
      {
        method: "POST",
        body: JSON.stringify({ search }),
      },
    );
  }

  async collectUrls(dto: CollectUrlsDto, submittedBy: string) {
    const version = dto.crawlerVersion ?? "v1";

    // v3(브라우저 없음)는 "현재 화면 상태"라는 개념이 없다 — 대신 관리자가
    // "검색조건" 탭에 저장해둔 값을 "현재"의 대체로 사용한다. v1/v2는 기존
    // 그대로(브라우저에 남아있는 화면 상태를 그대로 사용) 동작을 유지한다.
    if (version !== "v3") {
      await this.ensureCrawlerLoggedIn(submittedBy);
    } else {
      await this.checkTankLoginV3(submittedBy);
    }

    this.appendLog(
      "info",
      `${submittedBy}님이 주소 수집을 시작합니다 (프리셋: ${dto.preset}).`,
    );

    let searchConfig: CollectUrlsDto["search"];
    if (version === "v3") {
      // v3는 "현재" 프리셋 개념이 없다 — 관리자 화면(CrawlerSearchPanel)이
      // 필드별로 빈 값(=조건 없음, 전체 조회)이거나 채운 값인 완전한
      // CrawlerSearchConfig를 항상 dto.search로 보낸다. 관심조건/즐겨찾기를
      // 선택하면 그 값 그대로, 아무것도 선택하지 않으면 빈 값 그대로
      // 사용한다 — 관리자 기본 검색조건과는 절대 병합하지 않는다(이유는
      // countSearchResultsV3 주석 참고). dto.search 자체가 없을 때만
      // (관리자 화면 버그 등 비정상 호출) 방어적으로 막는다.
      if (!dto.search) {
        throw new ServiceUnavailableException(
          "검색조건 데이터가 전달되지 않았습니다. 관리자 화면을 새로고침한 뒤 다시 시도해 주세요.",
        );
      }
      searchConfig = dto.search;
    } else {
      const savedPreset = this.listSavedSearches().find(
        (item) => item.name === dto.preset,
      );
      searchConfig = savedPreset
        ? { ...savedPreset.search, ...dto.search }
        : dto.preset === "현재"
          ? undefined
          : this.resolveSearchConfig(dto.preset, dto.search);
    }

    const linkExistingMap =
      await this.auctionsService.getLinkCollectFilterMap();

    this.jobRunning = true;
    this.localStatus.phase = "collecting";
    // 주소 추가는 새로운 작업 목록을 만드는 시작점이므로, 이전 조회의
    // 완료 개수/DB 등록/DB 갱신 수치가 화면에 남아있으면 진행률이
    // 100%를 넘거나 방금 시작한 작업인데도 이전 결과가 섞여 보이는
    // 혼란이 있었다(실측 확인, 2026-07-17). 여기서 초기화한다.
    this.localStatus.completed = 0;
    this.localStatus.created = 0;
    this.localStatus.updated = 0;

    const path = version === "v3" ? "/collect-urls-v3" : "/collect-urls";

    let result: {
      ok: boolean;
      urls: CrawlerUrlEntry[];
      message?: string;
    };
    try {
      result = await this.workerFetch<{
        ok: boolean;
        urls: CrawlerUrlEntry[];
        message?: string;
      }>(path, {
        method: "POST",
        body: JSON.stringify(
          version === "v3"
            ? { preset: dto.preset, clear: dto.clear ?? true, search: searchConfig }
            : {
                preset: dto.preset,
                clear: dto.clear ?? true,
                search: searchConfig,
                ...this.crawlerCredentialBody(),
              },
        ),
        signal: abortTimeoutSignal(600_000),
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "주소 수집에 실패했습니다.";
      this.appendLog(
        "error",
        message.includes("fetch failed")
          ? "크롤러 워커 통신 실패 — 「워커 재시작」 후 다시 시도해 주세요."
          : message,
      );
      throw error;
    } finally {
      this.jobRunning = false;
    }

    if (result.message) this.appendLog("info", result.message);

    const rawUrls = result.urls ?? [];
    const { urls, excluded, deduped, naverRefresh, beforeResultTime } = filterCollectedUrls(
      rawUrls,
      linkExistingMap,
    );

    if (naverRefresh > 0) {
      this.appendLog(
        "info",
        `네이버 미수집 ${naverRefresh}건 포함 (입찰기일 미도래)`,
      );
    }
    if (beforeResultTime > 0) {
      this.appendLog(
        "info",
        `당일 5시 이전 제외 ${beforeResultTime}건 (낙찰 결과 미반영 시간대)`,
      );
    }
    if (excluded > 0) {
      this.appendLog(
        "info",
        `DB 중복 ${excluded}건 제외 (입찰기일 미도래)`,
      );
    }
    if (deduped > 0) {
      this.appendLog("info", `수집 목록 내 중복 ${deduped}건 제외`);
    }

    let finalUrls = urls;
    let mergeDeduped = 0;
    if (dto.clear === false && this.localStatus.urls.length > 0) {
      const merged = filterCollectedUrls(
        [...this.localStatus.urls, ...urls],
        linkExistingMap,
      );
      finalUrls = merged.urls;
      mergeDeduped = merged.deduped;
      if (mergeDeduped > 0) {
        this.appendLog("info", `기존 목록과 병합 중복 ${mergeDeduped}건 제외`);
      }
    }

    this.appendLog(
      "info",
      `탱크 ${rawUrls.length}건 → 작업목록 ${finalUrls.length}건` +
        (excluded > 0 ? ` (DB중복·입찰기일 미도래 ${excluded}건 제외)` : ""),
    );

    this.localStatus.urls = finalUrls;
    this.localStatus.total = finalUrls.length;
    this.localStatus.completed = 0;
    this.localStatus.preset = dto.preset;

    if (await this.isWorkerHealthy()) {
      await this.workerFetch("/urls", {
        method: "POST",
        body: JSON.stringify({ urls: finalUrls }),
      });
    }

    await this.syncWorkerStatus();
    return {
      ...result,
      urls: finalUrls,
      rawCount: rawUrls.length,
      excluded,
      deduped: deduped + mergeDeduped,
      naverRefresh,
      beforeResultTime,
    };
  }

  async loadLinksFromExcel(buffer: Buffer) {
    const links = this.auctionsService.extractLinksFromExcel(buffer);
    const entries: CrawlerUrlEntry[] = links.map((link) => ({
      label: link,
      url: link,
    }));

    this.localStatus.urls.push(...entries);
    this.localStatus.total = this.localStatus.urls.length;

    if (await this.isWorkerHealthy()) {
      await this.workerFetch("/urls", {
        method: "POST",
        body: JSON.stringify({ urls: this.localStatus.urls }),
      });
    }

    this.appendLog("info", `엑셀에서 ${links.length}건 URL을 불러왔습니다.`);
    return { urls: this.localStatus.urls, imported: links.length };
  }

  async manageUrls(dto: ManageUrlsDto) {
    if (dto.action === "clear") {
      this.localStatus.urls = [];
      this.localStatus.total = 0;
      this.localStatus.completed = 0;
    } else if (dto.action === "load" && dto.urls?.length) {
      this.localStatus.urls.push(...dto.urls);
      this.localStatus.total = this.localStatus.urls.length;
    } else if (dto.action === "add" && dto.url?.trim()) {
      const url = dto.url.trim();
      this.localStatus.urls.push({ label: url, url });
      this.localStatus.total = this.localStatus.urls.length;
    } else if (dto.action === "remove" && dto.indices?.length) {
      const removeSet = new Set(dto.indices);
      this.localStatus.urls = this.localStatus.urls.filter(
        (_, index) => !removeSet.has(index),
      );
      this.localStatus.total = this.localStatus.urls.length;
    }

    if (await this.isWorkerHealthy()) {
      await this.workerFetch("/urls", {
        method: "POST",
        body: JSON.stringify({
          urls: this.localStatus.urls,
        }),
      });
    }

    return { urls: this.localStatus.urls };
  }

  async startCrawl(dto: StartCrawlDto, submittedBy: string) {
    const version = dto.crawlerVersion ?? "v1";
    // v3(완전 HTTPX)는 브라우저(Selenium 워커)를 전혀 쓰지 않으므로
    // 관리자 PC의 Chrome 워커 연결·로그인 상태를 확인할 필요가 없다.
    // 워커 프로세스(runner.py serve) 자체는 여전히 필요하므로 ensureWorker는
    // 유지하되, 브라우저 준비 여부를 요구하는 로그인 확인만 건너뛴다.
    if (version !== "v3") {
      await this.ensureCrawlerLoggedIn(submittedBy);
    }
    await this.ensureWorker();
    const urls =
      dto.urls ??
      this.localStatus.urls.map((entry) => entry.url);

    if (urls.length === 0) {
      throw new ServiceUnavailableException("조회할 URL이 없습니다.");
    }

    this.localStatus.repeatAfterCollect = Boolean(dto.repeatAfterCollect);
    this.localStatus.created = 0;
    this.localStatus.updated = 0;
    this.jobRunning = true;

    this.appendLog(
      "info",
      `${submittedBy}님이 조회를 시작합니다 (총 ${urls.length}건).`,
    );

    try {
      const {
        callbackUrl,
        callbackSecret,
        mirrorCallbackUrl,
        mirrorCallbackSecret,
      } = this.dualWriteConfig();
      const mirror = this.mirrorCallbackConfig();
      if (this.isRemoteWorkerMode()) {
        this.appendLog("info", "DB 적재: 운영(Railway)");
        if (mirror) {
          this.appendLog("info", `로컬 mirror: ${mirror.callbackUrl}`);
        }
      } else {
        this.appendLog("info", `DB 적재: 로컬${mirror ? " + 운영" : ""}`);
        if (mirror) {
          this.appendLog("info", `운영 mirror: ${mirror.callbackUrl}`);
        }
      }

      const version = dto.crawlerVersion ?? "v1";
      const path =
        version === "v3"
          ? "/crawl/start-v3"
          : version === "v2"
            ? "/crawl/start-v2"
            : "/crawl/start";
      // v3(HTTPX)가 기본 경로이므로 평소에는 굳이 표시하지 않고, 예전
      // Selenium 경로(v1)를 쓸 때만 눈에 띄게 알린다.
      if (version === "v1") {
        this.appendLog("info", "실행 경로: Selenium(브라우저 사용)");
      }

      // v2/v3(HTTPX 기반 경로)는 자체 세션으로 로그인하므로 Selenium
      // 자격증명(userId/password)을 보내지 않는다. mirror 콜백은 세 경로 모두 동일하게 지원.
      const body =
        version === "v1"
          ? {
              urls,
              callbackUrl,
              callbackSecret,
              mirrorCallbackUrl,
              mirrorCallbackSecret,
              ...this.crawlerCredentialBody(),
            }
          : { urls, callbackUrl, callbackSecret };

      const result = await this.workerFetch<{ ok: boolean; message?: string }>(
        path,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      if (result.message) this.appendLog("info", result.message);
      await this.syncWorkerStatus();
      return result;
    } catch (error) {
      this.jobRunning = false;
      await this.syncWorkerStatus();
      throw error;
    }
  }

  async stopCrawl(submittedBy: string) {
    this.appendLog("info", `${submittedBy}님이 작업 중단을 요청했습니다.`);
    try {
      await this.workerFetch("/crawl/stop", {
        method: "POST",
        body: "{}",
      });
    } catch (error) {
      this.appendLog(
        "warn",
        `워커 중단 요청 실패: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
    this.localStatus.phase = "stopped";
    this.jobRunning = false;
    await this.syncWorkerStatus();
    return { ok: true };
  }

  async restartWorker(submittedBy: string) {
    if (this.isRemoteWorkerMode()) {
      this.appendLog(
        "info",
        `${submittedBy}님이 관리자 PC 크롤러 워커 재연결을 시도합니다.`,
      );
      await this.ensureRemoteWorker();
      this.appendLog("info", "관리자 PC 크롤러 워커에 연결되었습니다.");
      return { ok: true };
    }

    this.appendLog("info", `${submittedBy}님이 크롤러 워커 재시작을 요청했습니다.`);
    await this.stopWorker();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.ensureWorker();
    return { ok: true };
  }

  async importItem(
    raw: Record<string, unknown>,
    submittedBy: string,
    secret: string,
    options: { mirror?: boolean } = {},
  ) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }

    const dto = mapCrawledItem(raw);
    const label = String(dto.auctionNo || dto.address || "?").trim();

    const result = await this.auctionsService.importCrawledItem(
      dto,
      submittedBy || "crawler",
    );

    if (result.skipped) {
      const reason = (result as { reason?: string }).reason;
      if (reason === "invalid_auction_no" || reason === "invalid_address" || reason === "invalid_link") {
        if (!options.mirror) {
          const detail =
            reason === "invalid_auction_no"
              ? "경매번호 형식 오류"
              : reason === "invalid_address"
                ? "주소 없음"
                : "탱크 링크 형식 오류";
          this.appendLog("warn", `저장 스킵 (${detail}): ${label}`);
        }
      } else if ((result as { unchanged?: boolean }).unchanged) {
        if (!options.mirror) {
          this.appendLog("info", `${label} (변경 없음 — DB에 이미 있음)`);
        }
      } else if (!options.mirror) {
        this.appendLog("warn", `${label} 저장 스킵 (${reason || "unknown"})`);
      }
      return result;
    }

    if (!options.mirror) {
      const fromCrawlerWorker =
        submittedBy === "crawler" ||
        submittedBy.startsWith("crawler-");
      if (!fromCrawlerWorker) {
        this.appendLog(
          "info",
          result.created
            ? `${dto.auctionNo || dto.address} 등록완료`
            : `${dto.auctionNo || dto.address} 갱신완료`,
        );
      }
    }

    if (!options.mirror) {
      if (result.created) {
        this.localStatus.created += 1;
      } else {
        this.localStatus.updated += 1;
      }
    }

    if (!options.mirror) {
      this.config = loadCrawlerConfig();
      const algo = this.config.algorithm;
      if (
        algo.enabled &&
        algo.telegramEnabled &&
        checkAlgorithmMatch(dto, algo)
      ) {
        const message = buildAlgorithmTelegramMessage(dto);
        void this.telegramService.send(message).then((sent) => {
          if (sent) {
            this.appendLog(
              "info",
              `텔레그램 알림: ${dto.auctionNo || dto.address}`,
            );
          }
        });
      }
    }

    return result;
  }

  async importNaverId(
    raw: Record<string, unknown>,
    submittedBy: string,
    secret: string,
    options: { mirror?: boolean } = {},
  ) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }

    const auctionNo = String(raw.auctionNo ?? raw.auction_no ?? "").trim();
    const naverId = String(raw.naverId ?? raw.naver_id ?? "").trim();
    const result = await this.auctionsService.patchNaverIdOnly(
      auctionNo,
      naverId,
      submittedBy || "crawler-naver-backfill",
    );

    if (result.updated && !options.mirror) {
      this.localStatus.updated += 1;
      this.appendLog(
        "info",
        `[네이버ID] ${auctionNo} → ${naverId}`,
      );
    }

    return result;
  }

  async backfillNaverIds(submittedBy: string) {
    await this.ensureCrawlerLoggedIn(submittedBy);
    await this.ensureWorker();

    const items = await this.auctionsService.listMissingNaverId();
    if (items.length === 0) {
      return {
        ok: true,
        message: "네이버 ID가 필요한 물건이 없습니다.",
        total: 0,
      };
    }

    this.localStatus.created = 0;
    this.localStatus.updated = 0;
    this.jobRunning = true;

    this.appendLog(
      "info",
      `${submittedBy}님이 네이버 ID 수집을 시작합니다 (총 ${items.length}건).`,
    );

    const { callbackUrl, callbackSecret, mirrorCallbackUrl, mirrorCallbackSecret } =
      this.dualWriteConfig();

    const result = await this.workerFetch<{ ok: boolean; message?: string }>(
      "/crawl/backfill-naver-id",
      {
        method: "POST",
        body: JSON.stringify({
          items,
          callbackUrl,
          callbackSecret,
          mirrorCallbackUrl,
          mirrorCallbackSecret,
        }),
      },
    );
    if (result.message) this.appendLog("info", result.message);
    await this.syncWorkerStatus();
    return { ...result, total: items.length };
  }

  // v3(HTTPX) 네이버 호가/실거래 상세 포맷 수정(2026-07-17) 이후, 그 전에
  // 이미 v3로 수집돼 옛 포맷으로 저장된 물건들을 새 포맷으로 재수집하는
  // 1회성 백필. sinceHours 시간 내 생성/갱신된 물건만 대상으로 한다 —
  // DB에 크롤러 버전을 구분하는 컬럼이 없어 정확히 v3만 골라낼 수는
  // 없으므로(v1으로 방금 수집된 물건도 섞일 수 있음), 범위를 좁게
  // 잡는다. v1 물건이 섞여도 재조회 자체는 안전(콜백이 기존 레코드를
  // 갱신할 뿐 새로 만들지 않음).
  async backfillTodayNaverFormat(submittedBy: string, sinceHours = 24) {
    await this.checkTankLoginV3(submittedBy);
    await this.ensureWorker();

    const items = await this.auctionsService.listRecentlyUpdatedLinks(sinceHours);
    if (items.length === 0) {
      return { ok: true, message: "최근 수집된 물건이 없습니다.", total: 0 };
    }

    this.appendLog(
      "info",
      `${submittedBy}님이 최근 ${sinceHours}시간 내 물건 ${items.length}건을 새 네이버 포맷으로 재수집합니다.`,
    );

    return this.startCrawl(
      {
        urls: items.map((item) => item.link),
        crawlerVersion: "v3",
      },
      submittedBy,
    );
  }

  private schedulerRunning = false;

  /** 서버(Railway 컨테이너)는 기본 UTC로 동작하지만, 관리자 화면에서 입력하는
   * 예약 시간은 항상 한국시간(KST, UTC+9) 기준이다. Date.getHours() 등은
   * 실행 환경(서버는 UTC, 로컬 개발 PC는 보통 KST)의 로컬 시간대를 그대로
   * 반환해 환경마다 결과가 달라지므로, Intl.DateTimeFormat으로 Asia/Seoul을
   * 명시해 항상 같은 값을 얻는다. */
  private nowPartsInKst(): { year: number; month: number; date: number; hour: number; minute: number } {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    return {
      year: get("year"),
      month: get("month"),
      date: get("day"),
      // 자정(00시)을 Intl이 "24"로 표기하는 로케일 이슈 방어
      hour: get("hour") % 24,
      minute: get("minute"),
    };
  }

  private async tickScheduler() {
    this.config = loadCrawlerConfig();
    const schedule = this.config.schedule;
    if (!schedule.enabled || this.jobRunning || this.schedulerRunning) return;

    if (!schedule.repeatDaily && schedule.oneTimeCompleted) return;

    const now = this.nowPartsInKst();
    const [hour, minute] = schedule.time.split(":");
    if (
      now.hour !== parseInt(hour ?? "0", 10) ||
      now.minute !== parseInt(minute ?? "0", 10)
    ) {
      return;
    }

    const dateKey = `${now.year}-${String(now.month).padStart(2, "0")}-${String(now.date).padStart(2, "0")}`;
    if (schedule.repeatDaily && this.lastScheduledDate === dateKey) return;
    this.lastScheduledDate = dateKey;

    const presetList =
      schedule.presets && schedule.presets.length > 0
        ? schedule.presets
        : [schedule.preset];
    const repeatLabel = schedule.repeatDaily ? "매일" : "1회";
    this.appendLog(
      "info",
      `예약 작업 시작 (${repeatLabel} ${schedule.time}, 관심조건 ${presetList.length}건: ${presetList.join(", ")})`,
    );

    this.schedulerRunning = true;
    try {
      // v3(HTTPX)는 브라우저 세션이 없는 stateless 구조라 /session 자체가
      // 없다 — v1/v2 전용 로그인 확인은 v1/v2로 실행할 때만 필요하다.
      if ((schedule.crawlerVersion ?? "v1") !== "v3") {
        await this.ensureCrawlerLoggedIn("scheduler");
      }

      for (const preset of presetList) {
        if (preset === TODAY_BID_DATE_PRESET_ID) {
          this.appendLog("info", "[관심조건] 당일물건 조회 시작");
          try {
            const links = await this.auctionsService.listTodayBidDateLinks();
            if (links.length === 0) {
              this.appendLog("info", "[관심조건] 당일물건 조회 — 대상 물건 없음");
            } else {
              await this.startCrawl(
                {
                  urls: links.map((item) => item.link),
                  crawlerVersion: schedule.crawlerVersion ?? "v3",
                },
                "scheduler",
              );
              this.appendLog(
                "info",
                `[관심조건] 당일물건 조회 완료 (${links.length}건 재조회)`,
              );
            }
          } catch (error) {
            this.appendLog(
              "error",
              `[관심조건] 당일물건 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
            );
          }
          continue;
        }

        this.appendLog("info", `[관심조건] ${preset} 수집 시작`);
        try {
          await this.collectUrls(
            {
              preset,
              clear: true,
            },
            "scheduler",
          );

          if (schedule.repeatAfterCollect && this.localStatus.urls.length > 0) {
            await this.startCrawl(
              {
                repeatAfterCollect: true,
                crawlerVersion: schedule.crawlerVersion,
              },
              "scheduler",
            );
          }
          this.appendLog("info", `[관심조건] ${preset} 완료`);
        } catch (error) {
          this.appendLog(
            "error",
            `[관심조건] ${preset} 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
          );
        }
      }

      if (!schedule.repeatDaily) {
        this.updateConfig({
          schedule: {
            ...this.config.schedule,
            oneTimeCompleted: true,
            enabled: false,
          },
        });
        this.appendLog("info", "1회 예약 조회가 완료되어 예약이 해제되었습니다.");
      }
    } catch (error) {
      this.appendLog(
        "error",
        `예약 작업 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
      );
      this.jobRunning = false;
    } finally {
      this.schedulerRunning = false;
    }
  }

  async getCafeStatus() {
    await this.ensureWorker();
    return this.workerFetch<Record<string, unknown>>("/cafe/status");
  }

  async getCafeCollectedUrls() {
    await this.ensureWorker();
    return this.workerFetch<{
      ok: boolean;
      cafeUrl?: string;
      collectedAt?: string | null;
      total?: number;
      urls?: Array<{ url: string; title?: string; articleId?: string }>;
    }>("/cafe/collected-urls", { method: "GET" });
  }

  async startCafeUrlCollect(
    dto: {
      cafeUrl?: string;
      maxArticles?: number;
      maxPages?: number;
      userId?: string;
      password?: string;
    },
    username: string,
  ) {
    await this.ensureWorker();
    const credentials = this.resolveNaverCredentials(dto);
    if (credentials.userId && credentials.password) {
      this.updateConfig({
        naverCredentials: {
          userId: credentials.userId,
          password: credentials.password,
        },
      });
    }
    const cafeUrl =
      dto.cafeUrl?.trim() ||
      process.env.NAVER_CAFE_URL?.trim() ||
      "https://cafe.naver.com/0113053470";

    const known = await this.cafeKnowledgeService.getKnownCafeSources(cafeUrl);

    this.appendLog(
      "info",
      `[${username}] 카페 URL 목록 수집 시작 (${cafeUrl}, 최대 ${dto.maxArticles ?? 50}건) — 기수집 ${known.articleIds.length}건 제외`,
    );

    return this.workerFetch<{ ok: boolean; message?: string }>(
      "/cafe/collect-urls/start",
      {
        method: "POST",
        body: JSON.stringify({
          cafeUrl,
          maxArticles: dto.maxArticles ?? 50,
          maxPages: dto.maxPages ?? 5,
          knownUrls: known.urls,
          knownArticleIds: known.articleIds,
          ...this.naverCredentialBody(dto),
        }),
      },
    );
  }

  private resolveNaverCredentials(dto: CrawlerLoginDto = {}) {
    this.config = loadCrawlerConfig();
    const userId =
      dto.userId?.trim() ||
      this.config.naverCredentials?.userId?.trim() ||
      process.env.NAVER_USER?.trim() ||
      "";
    const password =
      dto.password ||
      this.config.naverCredentials?.password ||
      process.env.NAVER_PASSWORD ||
      "";
    return { userId, password };
  }

  private naverCredentialBody(dto: CrawlerLoginDto = {}) {
    const credentials = this.resolveNaverCredentials(dto);
    return {
      naverUserId: credentials.userId,
      naverPassword: credentials.password,
    };
  }

  async loginCafe(dto: CrawlerLoginDto, username: string) {
    const credentials = this.resolveNaverCredentials(dto);
    if (!credentials.userId || !credentials.password) {
      throw new ServiceUnavailableException(
        "네이버 ID와 비밀번호를 입력해 주세요.",
      );
    }

    this.updateConfig({
      naverCredentials: {
        userId: credentials.userId,
        password: credentials.password,
      },
    });

    await this.ensureWorker();
    this.appendLog("info", `[${username}] 네이버 자동 로그인 시도`);
    const result = await this.workerFetch<{
      ok: boolean;
      message?: string;
      naverLoggedIn?: boolean;
      needsManualAuth?: boolean;
    }>("/cafe/login", {
      method: "POST",
      body: JSON.stringify({
        naverUserId: credentials.userId,
        naverPassword: credentials.password,
      }),
      signal: abortTimeoutSignal(200_000),
    });
    if (result.naverLoggedIn) {
      this.appendLog("info", result.message ?? "네이버 로그인 완료");
    } else if (result.needsManualAuth) {
      this.appendLog(
        "warn",
        result.message ??
          "Chrome 창에서 추가 인증을 완료한 뒤 로그인 확인을 눌러 주세요.",
      );
    } else if (result.message) {
      this.appendLog("warn", result.message);
    }
    return result;
  }

  async openCafeLogin(username: string) {
    await this.ensureWorker();
    this.appendLog("info", `[${username}] 네이버 로그인 페이지 열기`);
    return this.workerFetch<{ ok: boolean; message?: string }>(
      "/cafe/open-login",
      { method: "POST", body: "{}" },
    );
  }

  async restartCafeBrowser(username: string, navigate?: string) {
    await this.ensureWorker();
    this.appendLog("info", `[${username}] 카페 Chrome 재시작`);
    return this.workerFetch<{
      ok: boolean;
      message?: string;
      naverLoggedIn?: boolean;
      currentUrl?: string;
    }>("/cafe/browser/restart", {
      method: "POST",
      body: JSON.stringify(navigate ? { navigate } : {}),
    });
  }

  async openCafe(cafeUrl: string, username: string) {
    await this.ensureWorker();
    this.appendLog("info", `[${username}] 카페 페이지 열기: ${cafeUrl}`);
    return this.workerFetch<{ ok: boolean; message?: string; naverLoggedIn?: boolean }>(
      "/cafe/open",
      {
        method: "POST",
        body: JSON.stringify({
          cafeUrl,
          ...this.naverCredentialBody(),
        }),
      },
    );
  }

  async checkCafeLogin(username: string) {
    await this.ensureWorker();
    return this.workerFetch<{
      ok: boolean;
      naverLoggedIn?: boolean;
      message?: string;
    }>("/cafe/check-login", { method: "POST", body: "{}" });
  }

  async startCafeCrawl(
    dto: {
      cafeUrl?: string;
      maxArticles?: number;
      maxPages?: number;
      userId?: string;
      password?: string;
    },
    username: string,
  ) {
    await this.ensureWorker();
    const credentials = this.resolveNaverCredentials(dto);
    if (credentials.userId && credentials.password) {
      this.updateConfig({
        naverCredentials: {
          userId: credentials.userId,
          password: credentials.password,
        },
      });
    }
    const { callbackUrl, callbackSecret } = this.cafeCallbackConfig();
    const cafeUrl =
      dto.cafeUrl?.trim() ||
      process.env.NAVER_CAFE_URL?.trim() ||
      "https://cafe.naver.com/0113053470";

    const known = await this.cafeKnowledgeService.getKnownCafeSources(cafeUrl);
    this.appendLog(
      "info",
      `[${username}] 카페 수집 시작 (${cafeUrl}, 최대 ${dto.maxArticles ?? 30}건, ${dto.maxPages ?? 5}페이지) — 기수집 ${known.urls.length}건 URL 제외`,
    );

    return this.workerFetch<{ ok: boolean; message?: string }>(
      "/cafe/crawl/start",
      {
        method: "POST",
        body: JSON.stringify({
          cafeUrl,
          maxArticles: dto.maxArticles ?? 30,
          maxPages: dto.maxPages ?? 5,
          knownUrls: known.urls,
          knownArticleIds: known.articleIds,
          callbackUrl,
          callbackSecret,
          ...this.naverCredentialBody(),
        }),
      },
    );
  }

  async stopCafeCrawl(username: string) {
    await this.ensureWorker();
    this.appendLog("info", `[${username}] 카페 수집 중단 요청`);
    return this.workerFetch<{ ok: boolean }>("/cafe/crawl/stop", {
      method: "POST",
      body: "{}",
    });
  }

  async importCafeArticle(
    dto: {
      articleUrl: string;
      cafeUrl?: string;
      userId?: string;
      password?: string;
    },
    username: string,
  ) {
    await this.ensureWorker();
    const credentials = this.resolveNaverCredentials(dto);
    if (credentials.userId && credentials.password) {
      this.updateConfig({
        naverCredentials: {
          userId: credentials.userId,
          password: credentials.password,
        },
      });
    }
    const { callbackUrl, callbackSecret } = this.cafeCallbackConfig();
    const articleUrl = dto.articleUrl?.trim() ?? "";
    if (!articleUrl.includes("cafe.naver.com")) {
      throw new ServiceUnavailableException(
        "카페 글 URL을 입력해 주세요. (cafe.naver.com)",
      );
    }

    this.appendLog("info", `[${username}] 카페 단일 글 수집: ${articleUrl}`);

    return this.workerFetch<{ ok: boolean; message?: string }>(
      "/cafe/crawl/single",
      {
        method: "POST",
        body: JSON.stringify({
          articleUrl,
          cafeUrl:
            dto.cafeUrl?.trim() ||
            process.env.NAVER_CAFE_URL?.trim() ||
            "https://cafe.naver.com/0113053470",
          callbackUrl,
          callbackSecret,
          ...this.naverCredentialBody(),
        }),
      },
    );
  }

  async importCafePost(
    raw: Record<string, unknown>,
    submittedBy: string,
    secret: string,
  ) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }

    const sourceArticleId = String(raw.sourceArticleId ?? "").trim();
    const sourceUrl = String(raw.sourceUrl ?? "").trim();
    const rawContent = String(raw.rawContent ?? "").trim();
    const markAsSkipped = Boolean(raw.markAsSkipped);

    if (markAsSkipped) {
      const result = await this.cafeKnowledgeService.importSkippedMarker({
        sourceArticleId,
        sourceUrl,
        sourceTitle: String(raw.sourceTitle ?? ""),
        sourceBoard: String(raw.sourceBoard ?? ""),
        cafeUrl: String(raw.cafeUrl ?? ""),
        rawContent,
        skipReason: String(raw.skipReason ?? raw.skip_reason ?? ""),
      });
      if (!result.skipped && "item" in result) {
        this.appendLog(
          "info",
          `카페 글 스킵 기록: ${String(raw.sourceTitle ?? sourceArticleId)}`,
        );
      }
      return result;
    }

    const result = await this.cafeKnowledgeService.importRawPost({
      sourceArticleId,
      sourceUrl,
      sourceTitle: String(raw.sourceTitle ?? ""),
      sourceBoard: String(raw.sourceBoard ?? ""),
      cafeUrl: String(raw.cafeUrl ?? ""),
      rawContent,
    });

    if (!result.skipped && "item" in result && result.item) {
      try {
        const draft = await this.cafeKnowledgeService.structureDraft(
          result.item.id,
        );
        if (draft.status === "structured") {
          this.appendLog(
            "info",
            `카페 지식 초안 정리: ${draft.title || result.item.sourceTitle}`,
          );
        } else if (draft.status === "skipped") {
          this.appendLog(
            "info",
            `카페 글 스킵(AI): ${String(raw.sourceTitle ?? sourceArticleId)} — ${draft.aiNote ?? ""}`,
          );
        }
        return { ...result, draftStatus: draft.status, draftId: draft.id };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "AI 초안 정리 실패";
        this.appendLog("warn", `카페 AI 정리 실패: ${message}`);
        return { ...result, structureError: message };
      }
    }

    if (!result.skipped) {
      this.appendLog(
        "info",
        `카페 글 저장: ${String(raw.sourceTitle ?? sourceArticleId)}`,
      );
    }

    return result;
  }

  async syncKnowledgeDraft(raw: Record<string, unknown>, secret: string) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }

    return this.cafeKnowledgeService.upsertDraftFromSync({
      sourceArticleId: String(raw.sourceArticleId ?? ""),
      sourceUrl: String(raw.sourceUrl ?? ""),
      sourceTitle: String(raw.sourceTitle ?? ""),
      sourceBoard: String(raw.sourceBoard ?? ""),
      cafeUrl: String(raw.cafeUrl ?? ""),
      rawContent: String(raw.rawContent ?? ""),
      title: String(raw.title ?? ""),
      category: String(raw.category ?? ""),
      tags: String(raw.tags ?? ""),
      content: String(raw.content ?? ""),
      aiNote: String(raw.aiNote ?? ""),
      status: (String(raw.status ?? "structured") || "structured") as KnowledgeDraftStatus,
      errorMessage:
        raw.errorMessage === null || raw.errorMessage === undefined
          ? null
          : String(raw.errorMessage),
    });
  }

  async syncKnowledge(raw: Record<string, unknown>, secret: string) {
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }

    return this.knowledgeService.upsertKnowledgeFromSync({
      id: raw.id ? String(raw.id) : undefined,
      title: String(raw.title ?? ""),
      category: String(raw.category ?? ""),
      tags: String(raw.tags ?? ""),
      content: String(raw.content ?? ""),
      active: raw.active === undefined ? true : Boolean(raw.active),
    });
  }
}
