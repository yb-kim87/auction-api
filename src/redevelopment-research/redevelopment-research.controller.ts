import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { RedevelopmentResearchService } from "./redevelopment-research.service";

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
  constructor(private readonly service: RedevelopmentResearchService) {}

  /** 경매물건이 속한 구역의 조사를 시작한다(백그라운드). 이미 진행 중이면 현재 상태를 돌려준다.
   * 상세를 다 못 가져왔으면(naverDetailRemaining > 0) 같은 호출로 "이어서 수집"한다. */
  @Post("auctions/:auctionId/start")
  async start(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body() body: { toleranceM?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.startForAuction(auctionId, parseTolerance(body?.toleranceM));
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

  /** 구역 조사 시작(경매물건 기준 시작과 같은 백그라운드 조사). */
  @Post("zones/:zoneId/start")
  async startZone(@Headers() headers: Record<string, string>, @Param("zoneId") zoneId: string) {
    requireAdmin(getAuthContext(headers));
    const run = await this.service.startZone(zoneId);
    return { zoneId, run };
  }

  /** 구역 기준 조사 상태만 가볍게 조회. */
  @Get("zones/:zoneId/status")
  async zoneStatus(@Headers() headers: Record<string, string>, @Param("zoneId") zoneId: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.getRun(zoneId);
  }
}
