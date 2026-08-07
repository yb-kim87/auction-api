import { Body, Controller, Get, Headers, Post, Query, ServiceUnavailableException } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { NiceCrawlerService } from "./nice-crawler.service";
import type { NiceCrawlerPhase } from "./entities/nice-crawler-state.entity";
import type { NiceSearchConfig } from "./nice-search.types";

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

  /** 탱크옥션의 "주소 추가"에 대응 — 검색조건으로 objId 작업목록을
   * 수집만 하고(상세조회/저장 없음), 아직 실행은 하지 않는다. */
  @Post("collect")
  async collect(
    @Headers() headers: Record<string, string>,
    @Body() body: { search: NiceSearchConfig },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.collect(body.search);
  }

  /** 작업목록 편집(선택 삭제/모두 삭제/수동 추가) — 탱크옥션
   * crawlerManageUrls와 동일한 계약. */
  @Post("manage-urls")
  async manageUrls(
    @Headers() headers: Record<string, string>,
    @Body()
    body: { action: "add" | "remove" | "clear"; objId?: string; label?: string; indices?: number[] },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.manageUrls(body);
  }

  @Post("start")
  async start(
    @Headers() headers: Record<string, string>,
    @Body() body: { resaleAnalysisEnabled?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.start({ resaleAnalysisEnabled: body?.resaleAnalysisEnabled });
  }

  @Post("stop")
  async stop(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.stop();
  }

  @Get("resale-run-summary")
  async resaleRunSummary(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getResaleRunSummary();
  }

  /** 로컬 워커 전용 상태 조회(secret 인증) — 관리자 세션이 없는 로컬
   * 스크립트가 running/searchConfig를 폴링하는 용도. 화면용 /status와는
   * 별도 경로다. */
  @Get("worker-status")
  async workerStatus(@Headers() headers: Record<string, string>) {
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }
    return this.service.getStatus();
  }

  @Get("saved-searches")
  async listSavedSearches(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listSavedSearches();
  }

  @Post("saved-searches")
  async saveSavedSearch(
    @Headers() headers: Record<string, string>,
    @Body() body: { id?: string; name: string; search: NiceSearchConfig },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.saveSavedSearch(body);
  }

  @Post("saved-searches/delete")
  async deleteSavedSearch(
    @Headers() headers: Record<string, string>,
    @Body() body: { id: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteSavedSearch(body.id);
  }

  /** 로컬 워커 전용(관리자 세션이 아니라 x-crawler-secret 인증). */
  @Post("progress")
  async progress(
    @Headers() headers: Record<string, string>,
    @Body()
    body: Partial<{
      phase: NiceCrawlerPhase;
      running: boolean;
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
