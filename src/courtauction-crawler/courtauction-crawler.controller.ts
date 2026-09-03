import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { CourtAuctionCrawlerService } from "./courtauction-crawler.service";
import type { CourtAuctionSearchConfig } from "./courtauction-search.types";

/** 대법원 법원경매정보 작업창 API — 탱크옥션(/crawler/*)·나이스
 * (/nice-crawler/*) 작업창과 완전히 별도. 전부 관리자 전용. */
@Controller("courtauction-crawler")
export class CourtAuctionCrawlerController {
  constructor(private readonly service: CourtAuctionCrawlerService) {}

  @Get("status")
  async status(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getStatus();
  }

  @Get("logs")
  async logs(@Headers() headers: Record<string, string>, @Query("limit") limit?: string) {
    requireAdmin(getAuthContext(headers));
    const parsed = limit ? Number(limit) : 200;
    return this.service.getLogs(Number.isFinite(parsed) ? parsed : 200);
  }

  @Post("logs/clear")
  async clearLogs(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.clearLogs();
  }

  /** 탱크옥션 "주소 추가"에 대응 — 검색조건으로 작업목록을 수집한다. */
  @Post("collect")
  async collect(
    @Headers() headers: Record<string, string>,
    @Body() body: { search: CourtAuctionSearchConfig },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.collect(body.search);
  }

  @Post("manage-urls")
  async manageUrls(
    @Headers() headers: Record<string, string>,
    @Body() body: { action: "remove" | "clear"; indices?: number[] },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.manageUrls(body);
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

  @Get("saved-searches")
  async listSavedSearches(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listSavedSearches();
  }

  @Post("saved-searches")
  async saveSavedSearch(
    @Headers() headers: Record<string, string>,
    @Body() body: { id?: string; name: string; search: CourtAuctionSearchConfig },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.saveSavedSearch(body);
  }

  @Post("saved-searches/delete")
  async deleteSavedSearch(@Headers() headers: Record<string, string>, @Body() body: { id: string }) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteSavedSearch(body.id);
  }
}
