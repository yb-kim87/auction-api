import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { spawn, type ChildProcess } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { AuctionsService } from "../auctions/auctions.service";
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

const WORKER_PORT = Number(process.env.CRAWLER_WORKER_PORT ?? 8765);
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const WORKER_START_TIMEOUT_MS = 30_000;

@Injectable()
export class CrawlerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrawlerService.name);
  private workerProcess: ChildProcess | null = null;
  private workerStarting: Promise<void> | null = null;
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
    void this.stopWorker();
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
    return { ...this.localStatus };
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

  private workerEnv() {
    return {
      ...process.env,
      CRAWLER_WORKER_PORT: String(WORKER_PORT),
      TANK_AUCTION_USER: process.env.TANK_AUCTION_USER ?? "",
      TANK_AUCTION_PASSWORD: process.env.TANK_AUCTION_PASSWORD ?? "",
      CRAWLER_CALLBACK_URL:
        process.env.CRAWLER_CALLBACK_URL ??
        `http://127.0.0.1:${process.env.PORT ?? 3001}/crawler/import-item`,
      CRAWLER_SECRET: process.env.CRAWLER_SECRET ?? "local-crawler-secret",
    };
  }

  private async workerFetch<T>(
    path: string,
    init?: RequestInit,
  ): Promise<T> {
    try {
      const res = await fetch(`${WORKER_URL}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
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
      throw new ServiceUnavailableException(message);
    }
  }

  private async isWorkerHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${WORKER_URL}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async ensureWorker(): Promise<void> {
    if (await this.isWorkerHealthy()) {
      this.localStatus.workerRunning = true;
      return;
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
    if (await this.isWorkerHealthy()) {
      try {
        await this.workerFetch("/shutdown", { method: "POST", body: "{}" });
      } catch {
        // ignore
      }
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
      const remote = await this.workerFetch<Partial<CrawlerStatus>>("/status");
      this.mergeWorkerStatus(remote);
      if (remote.phase === "idle" || remote.phase === "stopped") {
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

  private async ensureCrawlerLoggedIn(
    submittedBy: string,
    retried = false,
    options: { strict?: boolean } = {},
  ) {
    const strict = options.strict ?? false;
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
        `${submittedBy}: 브라우저 미연결 또는 미로그인 — 저장된 계정으로 자동 로그인합니다.`,
      );

      const result = await this.workerFetch<{ ok: boolean; message?: string }>(
        "/ensure-login",
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
        throw error;
      }
      this.appendLog(
        "warn",
        `${submittedBy}: 자동 로그인에 실패했습니다. 브라우저 로그인 상태를 확인한 뒤 계속 진행합니다. (${message})`,
      );
    }
  }

  async collectUrls(dto: CollectUrlsDto, submittedBy: string) {
    await this.ensureCrawlerLoggedIn(submittedBy, false, { strict: false });

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
      }),
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

    const result = await this.workerFetch<{ ok: boolean; message?: string }>(
      "/crawl/start",
      {
        method: "POST",
        body: JSON.stringify({ urls }),
      },
    );
    if (result.message) this.appendLog("info", result.message);
    await this.syncWorkerStatus();
    return result;
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
      return result;
    }

    if (result.created) {
      this.localStatus.created += 1;
      this.appendLog(
        "info",
        `[등록] ${dto.auctionNo || dto.address || "물건"}`,
      );
    } else {
      this.localStatus.updated += 1;
      this.appendLog(
        "info",
        `[갱신] ${dto.auctionNo || dto.address || "물건"}`,
      );
    }

    this.config = loadCrawlerConfig();
    const algo = this.config.algorithm;
    if (
      algo.enabled &&
      algo.telegramEnabled &&
      checkAlgorithmMatch(dto, algo)
    ) {
      const message = buildAlgorithmTelegramMessage(dto);
      const sent = await this.telegramService.send(message);
      if (sent) {
        this.appendLog("info", `텔레그램 알림: ${dto.auctionNo || dto.address}`);
      }
    }

    return result;
  }

  async importNaverId(
    raw: Record<string, unknown>,
    submittedBy: string,
    secret: string,
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

    if (result.updated) {
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

    const result = await this.workerFetch<{ ok: boolean; message?: string }>(
      "/crawl/backfill-naver-id",
      {
        method: "POST",
        body: JSON.stringify({ items }),
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
}
