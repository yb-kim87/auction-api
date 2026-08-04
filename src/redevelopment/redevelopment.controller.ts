import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { RedevelopmentService } from "./redevelopment.service";

/** 재개발 구역도 관리 + 경매물건 구역 포함 여부 판별(관리자 전용).
 * 사용자 요청, 2026-08-04: "물건작업 → 매도분석 옆에 재개발물건 탭". */
@Controller("redevelopment")
export class RedevelopmentController {
  constructor(private readonly service: RedevelopmentService) {}

  @Get("zones")
  async listZones(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listZones();
  }

  @Post("zones")
  async createZone(
    @Headers() headers: Record<string, string>,
    @Body()
    body: { name?: string; region?: string; stage?: string; memo?: string; polygon?: unknown; color?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.createZone(body);
  }

  @Patch("zones/:id")
  async updateZone(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      region?: string;
      stage?: string;
      memo?: string;
      polygon?: unknown;
      color?: string | null;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateZone(id, body);
  }

  @Delete("zones/:id")
  async deleteZone(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteZone(id);
  }

  @Get("map-data")
  async getMapData(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getMapData();
  }

  @Get("zones/:id/auctions")
  async getAuctionsInZone(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.getAuctionsInZone(id);
  }
}
