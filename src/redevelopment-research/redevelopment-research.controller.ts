import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { AuctionZoneCoordService } from "./auction-zone-coord.service";
import { RedevelopmentResearchService } from "./redevelopment-research.service";
import { ZoneBlogService } from "./zone-blog.service";

function parseTolerance(raw: unknown, fallback = 30): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException("toleranceM은 0 이상의 숫자여야 합니다.");
  return n;
}

/** 재개발 구역 매물 조사(네이버 매매 매물 + 국토부 실거래, 관리자 전용).
 * 사용자 요청, 2026-10-24: "관심매물을 등록하면 같은 재개발 구역 안 매물(호가)·실거래(최근 1년)를 조사". */
@Controller("redevelopment-research")
export class RedevelopmentResearchController {
  constructor(
    private readonly service: RedevelopmentResearchService,
    private readonly zoneBlog: ZoneBlogService,
    private readonly auctionCoord: AuctionZoneCoordService,
  ) {}

  /** 좌표 없는 기존 서울 빌라 경매물건을 서버에서 한 번에 채운다(구역 근처만 저장, 백그라운드). */
  @Post("auction-coords/backfill")
  async startCoordBackfill(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.auctionCoord.startBackfill();
  }

  @Get("auction-coords/status")
  async coordBackfillStatus(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.auctionCoord.getBackfillStatus();
  }

  /** 경매물건이 속한 구역의 조사를 시작한다(백그라운드). 이미 진행 중이면 현재 상태를 돌려준다.
   * 상세를 다 못 가져왔으면(naverDetailRemaining > 0) 같은 호출로 "이어서 수집"한다. */
  @Post("auctions/:auctionId/start")
  async start(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body() body: { toleranceM?: number; tradeLimit?: number; fast?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.startForAuction(auctionId, parseTolerance(body?.toleranceM), body?.tradeLimit, body?.fast === true);
  }

  /** 경매물건 기준 조사 결과 + 진행 상태(폴링용). */
  @Get("auctions/:auctionId")
  async auctionResult(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Query("toleranceM") toleranceM?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.getAuctionResearch(auctionId, parseTolerance(toleranceM));
  }

  /** 구역 팝업 조사 표에 함께 들어가는 경매물건 여러 건의 공시가만 한 번에 추정
   * (사용자 요청, 2026-10-25). 네이버/국토부는 부르지 않는 가벼운 경로라 구역 조사와
   * 별개로 호출해도 안전하다. */
  @Post("auctions/official-price-batch")
  async auctionsOfficialPriceBatch(@Headers() headers: Record<string, string>, @Body() body: { ids?: string[] }) {
    requireAdmin(getAuthContext(headers));
    const ids = (body?.ids ?? []).filter((id) => typeof id === "string" && id.trim());
    if (!ids.length) return [];
    if (ids.length > 200) throw new BadRequestException("한 번에 최대 200건까지 조회할 수 있습니다.");
    return this.service.getAuctionsOfficialPriceBatch(ids);
  }

  /** 지도용: 조사로 저장된 호가·실거래 점(가격 라벨). */
  @Get("map-points")
  async mapPoints(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getMapPoints();
  }

  /** 구역 기준 조사 결과(구역 라벨을 눌렀을 때) — 경매물건 기준 결과와 같은 모양이고 target만 null. */
  @Get("zones/:zoneId/results")
  async zoneResults(@Headers() headers: Record<string, string>, @Param("zoneId") zoneId: string, @Query("toleranceM") toleranceM?: string) {
    requireAdmin(getAuthContext(headers));
    return { target: null, ...(await this.service.getZoneResults(zoneId, parseTolerance(toleranceM))) };
  }

  /** 재개발 블로그(후니동산)만 다시 조사해 동의율·공문 타임라인을 갱신한다(네이버 부동산·국토부는 부르지 않음). */
  @Post("zones/:zoneId/blog-refresh")
  async blogRefresh(@Headers() headers: Record<string, string>, @Param("zoneId") zoneId: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.refreshBlog(zoneId);
  }

  /** 구역 조사 시작(경매물건 기준 시작과 같은 백그라운드 조사). */
  @Post("zones/:zoneId/start")
  async startZone(
    @Headers() headers: Record<string, string>,
    @Param("zoneId") zoneId: string,
    @Body() body: { tradeLimit?: number; fast?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    const run = await this.service.startZone(zoneId, body?.tradeLimit, body?.fast === true);
    return { zoneId, run };
  }

  /** 구역 목록용: 조사 이력이 있는 모든 구역의 최근 조사 상태(미조사 구역은 행이 없음). */
  @Get("zones-runs")
  async zonesRuns(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listRuns();
  }

  /** 구역 목록에서 저장된 최신 블로그 동의율을 한 번에 표시한다. */
  @Get("zones-blog-consents")
  async zonesBlogConsents(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.zoneBlog.listConsentSummaries();
  }

  /** 빠른 조사로 모은 매물 하나의 상세·단지 정보를 지금 가져온다(네이버 최대 3회). */
  @Post("zones/:zoneId/listings/:articleNo/detail")
  async listingDetail(
    @Headers() headers: Record<string, string>,
    @Param("zoneId") zoneId: string,
    @Param("articleNo") articleNo: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.fetchListingDetail(zoneId, articleNo);
  }

  /** 구역 기준 조사 상태만 가볍게 조회. */
  @Get("zones/:zoneId/status")
  async zoneStatus(@Headers() headers: Record<string, string>, @Param("zoneId") zoneId: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.getRun(zoneId);
  }
}
