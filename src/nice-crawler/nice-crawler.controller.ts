import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { NiceCrawlerService } from "./nice-crawler.service";
import type { NiceCrawlerPhase } from "./entities/nice-crawler-state.entity";

/** 나이스옥션 작업창 API — 탱크옥션 작업창(/crawler/*)과 완전히 별도.
 * 관리자 UI(NiceCrawlerWorkPanel.tsx)와 로컬 워커
 * (crawler/nice_worker.py) 양쪽이 호출한다. */
@Controller("nice-crawler")
export class NiceCrawlerController {
  constructor(private readonly service: NiceCrawlerService) {}

  @Get("status")
  async status(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getStatus();
  }

  @Get("logs")
  async logs(
    @Headers() headers: Record<string, string>,
    @Query("limit") limit?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    const parsed = limit ? Number(limit) : 200;
    return this.service.getLogs(Number.isFinite(parsed) ? parsed : 200);
  }

  @Post("logs/clear")
  async clearLogs(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.clearLogs();
  }

  @Post("start")
  async start(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.start();
  }

  @Post("stop")
  async stop(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.stop();
  }

  /** 로컬 워커 전용(관리자 세션이 아니라 x-crawler-secret 인증). */
  @Post("progress")
  async progress(
    @Headers() headers: Record<string, string>,
    @Body()
    body: Partial<{
      phase: NiceCrawlerPhase;
      totalObjIds: number;
      matched: number;
      completed: number;
      lastMessage: string | null;
      error: string | null;
    }>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    return this.service.reportProgress(secret, body);
  }

  @Post("worker-log")
  async workerLog(
    @Headers() headers: Record<string, string>,
    @Body() body: { message?: string; level?: string },
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      return { ok: false };
    }
    const message = String(body.message ?? "").trim();
    if (message) {
      const level = body.level === "warn" || body.level === "error" ? body.level : "info";
      await this.service.appendLog(level, message);
    }
    return { ok: true };
  }

  @Post("import-item")
  async importItem(
    @Headers() headers: Record<string, string>,
    @Body() body: Record<string, unknown>,
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    return this.service.importItem(body, secret);
  }
}
