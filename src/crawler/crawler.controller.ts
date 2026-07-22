import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  getAuthContext,
  requireAdmin,
} from "../common/auth-context";
import { CrawlerService } from "./crawler.service";
import type {
  CollectUrlsDto,
  CrawlerConfig,
  CrawlerLoginDto,
  CrawlerSearchConfig,
  ManageUrlsDto,
  SaveSearchPresetDto,
  StartCrawlDto,
} from "./crawler.types";

@Controller("crawler")
export class CrawlerController {
  constructor(private readonly crawlerService: CrawlerService) {}

  @Get("status")
  async status(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.getStatus();
  }

  @Get("config")
  getConfig(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.getConfig();
  }

  @Post("config")
  updateConfig(
    @Headers() headers: Record<string, string>,
    @Body() body: Partial<CrawlerConfig>,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.updateConfig(body);
  }

  @Get("logs")
  logs(
    @Headers() headers: Record<string, string>,
    @Query("limit") limit?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    const parsed = limit ? Number(limit) : 200;
    return this.crawlerService.getLogs(Number.isFinite(parsed) ? parsed : 200);
  }

  @Post("logs/clear")
  clearLogs(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    this.crawlerService.clearLogs();
    return { ok: true };
  }

  @Post("worker-log")
  workerLog(
    @Headers() headers: Record<string, string>,
    @Body() body: { message?: string; level?: string },
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }
    const message = String(body.message ?? "").trim();
    if (message) {
      const level =
        body.level === "warn" || body.level === "error" ? body.level : "info";
      this.crawlerService.appendWorkerLog(level, message);
    }
    return { ok: true };
  }

  @Post("tank-login-check")
  async checkTankLoginV3(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.checkTankLoginV3(ctx.username);
  }

  @Get("tank-favorite-searches")
  async listTankFavoriteSearches(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.listTankFavoriteSearches(ctx.username);
  }

  @Post("login")
  async login(
    @Headers() headers: Record<string, string>,
    @Body() body: CrawlerLoginDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.login(ctx.username, body);
  }

  @Post("count-search-v3")
  async countSearchResultsV3(
    @Headers() headers: Record<string, string>,
    @Body() body: { search?: CrawlerSearchConfig },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.countSearchResultsV3(body.search);
  }

  @Post("collect-urls")
  async collectUrls(
    @Headers() headers: Record<string, string>,
    @Body() body: CollectUrlsDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.collectUrls(
      {
        preset: body.preset ?? "현재",
        clear: body.clear ?? true,
        search: body.search,
        crawlerVersion: body.crawlerVersion,
      },
      ctx.username,
    );
  }

  @Get("saved-searches")
  listSavedSearches(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.listSavedSearches();
  }

  @Post("saved-searches")
  saveSavedSearch(
    @Headers() headers: Record<string, string>,
    @Body() body: SaveSearchPresetDto,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.name?.trim()) {
      throw new BadRequestException("이름을 입력해 주세요.");
    }
    return this.crawlerService.saveSavedSearch(body);
  }

  @Post("saved-searches/delete")
  deleteSavedSearch(
    @Headers() headers: Record<string, string>,
    @Body() body: { id: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.deleteSavedSearch(body.id);
  }

  @Post("load-excel")
  @UseInterceptors(FileInterceptor("file"))
  async loadExcel(
    @Headers() headers: Record<string, string>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!file?.buffer?.length) {
      throw new BadRequestException("엑셀 파일을 선택해 주세요.");
    }
    return this.crawlerService.loadLinksFromExcel(file.buffer);
  }

  @Post("urls")
  manageUrls(
    @Headers() headers: Record<string, string>,
    @Body() body: ManageUrlsDto,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.manageUrls(body);
  }

  @Post("start")
  async startCrawl(
    @Headers() headers: Record<string, string>,
    @Body() body: StartCrawlDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.startCrawl(body, ctx.username);
  }

  @Post("stop")
  async stopCrawl(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.stopCrawl(ctx.username);
  }

  @Post("restart-worker")
  async restartWorker(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.restartWorker(ctx.username);
  }

  @Post("import-item")
  importItem(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const mirror = headers["x-crawler-mirror"] === "1";
    const submittedBy =
      typeof body.submittedBy === "string" ? body.submittedBy : "crawler";
    const { submittedBy: _, ...raw } = body;
    return this.crawlerService.importItem(raw, submittedBy, secret, { mirror });
  }

  @Post("import-naver-id")
  importNaverId(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const mirror = headers["x-crawler-mirror"] === "1";
    const submittedBy =
      typeof body.submittedBy === "string"
        ? body.submittedBy
        : "crawler-naver-backfill";
    return this.crawlerService.importNaverId(body, submittedBy, secret, {
      mirror,
    });
  }

  @Post("backfill-naver-id")
  async backfillNaverIds(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.backfillNaverIds(ctx.username);
  }

  @Get("missing-shared-area")
  async missingSharedArea(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      requireAdmin(ctx);
    }
    return this.crawlerService.listMissingSharedArea();
  }

  @Post("import-shared-area")
  importSharedArea(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const submittedBy =
      typeof body.submittedBy === "string"
        ? body.submittedBy
        : "crawler-shared-area-backfill";
    return this.crawlerService.importSharedArea(body, submittedBy, secret);
  }

  @Get("missing-official-land-price")
  async missingOfficialLandPrice(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      requireAdmin(ctx);
    }
    return this.crawlerService.listMissingOfficialLandPrice();
  }

  @Post("import-official-land-price")
  importOfficialLandPrice(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const submittedBy =
      typeof body.submittedBy === "string"
        ? body.submittedBy
        : "crawler-land-price-backfill";
    return this.crawlerService.importOfficialLandPrice(body, submittedBy, secret);
  }

  @Post("backfill-today-naver-format")
  async backfillTodayNaverFormat(
    @Headers() headers: Record<string, string>,
    @Body() body: { sinceHours?: number },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.backfillTodayNaverFormat(
      ctx.username,
      body.sinceHours,
    );
  }

  @Get("cafe/status")
  async cafeStatus(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.getCafeStatus();
  }

  @Get("cafe/collected-urls")
  async cafeCollectedUrls(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.crawlerService.getCafeCollectedUrls();
  }

  @Post("cafe/collect-urls")
  async cafeCollectUrls(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      cafeUrl?: string;
      maxArticles?: number;
      maxPages?: number;
      userId?: string;
      password?: string;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.startCafeUrlCollect(body, ctx.username);
  }

  @Post("cafe/open-login")
  async cafeOpenLogin(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.openCafeLogin(ctx.username);
  }

  @Post("cafe/browser/restart")
  async cafeBrowserRestart(
    @Headers() headers: Record<string, string>,
    @Body() body: { navigate?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.restartCafeBrowser(ctx.username, body.navigate);
  }

  @Post("cafe/login")
  async cafeLogin(
    @Headers() headers: Record<string, string>,
    @Body() body: CrawlerLoginDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.loginCafe(body, ctx.username);
  }

  @Post("cafe/open")
  async cafeOpen(
    @Headers() headers: Record<string, string>,
    @Body() body: { cafeUrl?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.openCafe(
      body.cafeUrl ?? "https://cafe.naver.com/0113053470",
      ctx.username,
    );
  }

  @Post("cafe/check-login")
  async cafeCheckLogin(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.checkCafeLogin(ctx.username);
  }

  @Post("cafe/start")
  async cafeStart(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      cafeUrl?: string;
      maxArticles?: number;
      maxPages?: number;
      userId?: string;
      password?: string;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.startCafeCrawl(body, ctx.username);
  }

  @Post("cafe/stop")
  async cafeStop(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.stopCafeCrawl(ctx.username);
  }

  @Post("cafe/import-article")
  async cafeImportArticle(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      articleUrl: string;
      cafeUrl?: string;
      userId?: string;
      password?: string;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.importCafeArticle(body, ctx.username);
  }

  @Post("import-cafe-post")
  importCafePost(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const submittedBy =
      typeof body.submittedBy === "string" ? body.submittedBy : "crawler-cafe";
    const { submittedBy: _, ...raw } = body;
    return this.crawlerService.importCafePost(raw, submittedBy, secret);
  }

  @Post("sync/knowledge-draft")
  syncKnowledgeDraft(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    return this.crawlerService.syncKnowledgeDraft(body, secret);
  }

  @Post("sync/knowledge")
  syncKnowledge(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    return this.crawlerService.syncKnowledge(body, secret);
  }
}
