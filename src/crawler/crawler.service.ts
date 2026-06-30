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
import { AuctionsService } from "../auctions/auctions.service";
import { CafeKnowledgeService } from "../ai/cafe-knowledge.service";
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
import type {
  CollectUrlsDto,
  CrawlerConfig,
  CrawlerLogEntry,
  CrawlerLoginDto,
  CrawlerStatus,
  CrawlerUrlEntry,
  ManageUrlsDto,
  StartCrawlDto,
} from "./crawler.types";

const DEFAULT_WORKER_PORT = Number(process.env.CRAWLER_WORKER_PORT ?? 8765);
const WORKER_START_TIMEOUT_MS = 30_000;
const REMOTE_WORKER_OFFLINE_MESSAGE =
  "관리자 PC가 꺼져 있거나 크롤러 워커에 연결할 수 없습니다. PC에서 auction-api(npm run start:dev)와 크롤러 터널을 실행한 뒤 다시 시도해 주세요.";

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
  ) {
    const dataDir = join(process.cwd(), "data", "crawler");
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    this.applyScheduleToStatus();
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
    init?: RequestInit,
  ): Promise<T> {
    try {
      const res = await fetch(`${this.workerBaseUrl()}${path}`, {
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
      const res = await fetch(`${this.workerBaseUrl()}/health`, {
        signal: AbortSignal.timeout(this.isRemoteWorkerMode() ? 5000 : 1500),
      });
      if (!res.ok) return false;

      const secret = process.env.CRAWLER_WORKER_SECRET?.trim();
      if (!secret || this.isRemoteWorkerMode()) return true;

      const statusRes = await fetch(`${this.workerBaseUrl()}/status`, {
        signal: AbortSignal.timeout(1500),
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
      const healthOnly = await fetch(`${this.workerBaseUrl()}/health`, {
        signal: AbortSignal.timeout(1500),
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
      if (text) {
        this.logger.warn(`[crawler-worker] ${text}`);
        this.appendLog("warn", text);
      }
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

    const { created: _c, updated: _u, ...rest } = remote;
    this.localStatus = {
      ...this.localStatus,
      ...rest,
      workerRunning: true,
    };
  }

  private async syncWorkerStatus() {
    if (!(await this.isWorkerHealthy())) {
      this.localStatus.workerRunning = false;
      this.localStatus.browserReady = false;
      if (this.localStatus.phase !== "error" && !this.jobRunning) {
        this.localStatus.phase = "idle";
      }
      return;
    }

    try {
      const remote = await this.workerFetch<
        Partial<CrawlerStatus> & { events?: string[] }
      >("/status");
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
      this.localStatus.workerRunning = false;
    }
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

  async collectUrls(dto: CollectUrlsDto, submittedBy: string) {
    await this.ensureCrawlerLoggedIn(submittedBy);

    this.appendLog(
      "info",
      `${submittedBy}님이 주소 수집을 시작합니다 (프리셋: ${dto.preset}).`,
    );

    const searchConfig =
      dto.preset === "현재"
        ? undefined
        : this.resolveSearchConfig(dto.preset, dto.search);

    const linkExistingMap =
      await this.auctionsService.getLinkCollectFilterMap();

    const result = await this.workerFetch<{
      ok: boolean;
      urls: CrawlerUrlEntry[];
      message?: string;
    }>("/collect-urls", {
      method: "POST",
      body: JSON.stringify({
        preset: dto.preset,
        clear: dto.clear ?? true,
        search: searchConfig,
        ...this.crawlerCredentialBody(),
      }),
      signal: AbortSignal.timeout(600_000),
    });

    if (result.message) this.appendLog("info", result.message);

    const rawUrls = result.urls ?? [];
    const { urls, excluded, deduped, naverRefresh } = filterCollectedUrls(
      rawUrls,
      linkExistingMap,
    );

    if (naverRefresh > 0) {
      this.appendLog(
        "info",
        `네이버 미수집 ${naverRefresh}건 포함 (입찰기일 미도래)`,
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
      excluded,
      deduped: deduped + mergeDeduped,
      naverRefresh,
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
    await this.ensureCrawlerLoggedIn(submittedBy);
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

      const result = await this.workerFetch<{ ok: boolean; message?: string }>(
        "/crawl/start",
        {
          method: "POST",
          body: JSON.stringify({
            urls,
            callbackUrl,
            callbackSecret,
            mirrorCallbackUrl,
            mirrorCallbackSecret,
            ...this.crawlerCredentialBody(),
          }),
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
    if (await this.isWorkerHealthy()) {
      await this.workerFetch("/crawl/stop", {
        method: "POST",
        body: "{}",
      });
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
    const result = await this.auctionsService.importCrawledItem(
      dto,
      submittedBy || "crawler",
    );

    if (result.skipped) {
      const reason = (result as { reason?: string }).reason;
      if (reason === "invalid_auction_no" || reason === "invalid_address" || reason === "invalid_link") {
        this.appendLog(
          "warn",
          `저장 스킵 (물건 아님): ${String(dto.auctionNo ?? dto.address ?? "?")}`,
        );
      }
      return result;
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

  private async tickScheduler() {
    this.config = loadCrawlerConfig();
    const schedule = this.config.schedule;
    if (!schedule.enabled || this.jobRunning) return;

    if (!schedule.repeatDaily && schedule.oneTimeCompleted) return;

    const now = new Date();
    const [hour, minute] = schedule.time.split(":");
    if (
      now.getHours() !== parseInt(hour ?? "0", 10) ||
      now.getMinutes() !== parseInt(minute ?? "0", 10)
    ) {
      return;
    }

    const dateKey = now.toISOString().slice(0, 10);
    if (schedule.repeatDaily && this.lastScheduledDate === dateKey) return;
    this.lastScheduledDate = dateKey;

    const repeatLabel = schedule.repeatDaily ? "매일" : "1회";
    this.appendLog(
      "info",
      `예약 작업 시작 (${repeatLabel} ${schedule.time}, ${schedule.preset})`,
    );

    try {
      this.jobRunning = true;
      await this.ensureCrawlerLoggedIn("scheduler");
      await this.collectUrls(
        {
          preset: schedule.preset,
          clear: true,
        },
        "scheduler",
      );

      if (schedule.repeatAfterCollect && this.localStatus.urls.length > 0) {
        await this.startCrawl(
          { repeatAfterCollect: true },
          "scheduler",
        );
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
        error instanceof Error ? error.message : "예약 작업 실패",
      );
      this.jobRunning = false;
    }
  }

  async getCafeStatus() {
    await this.ensureWorker();
    return this.workerFetch<Record<string, unknown>>("/cafe/status");
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
    }>("/cafe/login", {
      method: "POST",
      body: JSON.stringify({
        naverUserId: credentials.userId,
        naverPassword: credentials.password,
      }),
    });
    if (result.message) this.appendLog("info", result.message);
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

    this.appendLog(
      "info",
      `[${username}] 카페 수집 시작 (${cafeUrl}, 최대 ${dto.maxArticles ?? 30}건)`,
    );

    return this.workerFetch<{ ok: boolean; message?: string }>(
      "/cafe/crawl/start",
      {
        method: "POST",
        body: JSON.stringify({
          cafeUrl,
          maxArticles: dto.maxArticles ?? 30,
          maxPages: dto.maxPages ?? 5,
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

    const result = await this.cafeKnowledgeService.importRawPost({
      sourceArticleId,
      sourceUrl,
      sourceTitle: String(raw.sourceTitle ?? ""),
      sourceBoard: String(raw.sourceBoard ?? ""),
      cafeUrl: String(raw.cafeUrl ?? ""),
      rawContent,
    });

    if (!result.skipped) {
      this.appendLog(
        "info",
        `카페 글 저장: ${String(raw.sourceTitle ?? sourceArticleId)}`,
      );
    }

    return result;
  }
}
