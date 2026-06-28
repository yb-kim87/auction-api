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
  ManageUrlsDto,
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

  @Post("login")
  async login(
    @Headers() headers: Record<string, string>,
    @Body() body: CrawlerLoginDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.login(ctx.username, body);
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
      },
      ctx.username,
    );
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
    const submittedBy =
      typeof body.submittedBy === "string" ? body.submittedBy : "crawler";
    const { submittedBy: _, ...raw } = body;
    return this.crawlerService.importItem(raw, submittedBy, secret);
  }

  @Post("import-naver-id")
  importNaverId(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const submittedBy =
      typeof body.submittedBy === "string"
        ? body.submittedBy
        : "crawler-naver-backfill";
    return this.crawlerService.importNaverId(body, submittedBy, secret);
  }

  @Post("backfill-naver-id")
  async backfillNaverIds(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.crawlerService.backfillNaverIds(ctx.username);
  }
}
