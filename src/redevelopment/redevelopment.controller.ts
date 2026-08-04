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

  /** 공공데이터 자동 수집(서울 upisRebuild 등) 결과를 배치로 저장한다.
   * 지오코딩은 프론트(Vercel)에서 처리해 완성된 폴리곤을 넘겨준다 —
   * Railway가 VWorld API에 직접 연결 못 하는 문제(2026-08-04, 매도분석
   * 지도에서 확인된 것과 동일)와 같은 이유로 백엔드에서 직접 수집하지
   * 않는다. */
  @Post("zones/bulk-upsert")
  async bulkUpsertZones(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      items?: Array<{
        name?: string;
        region?: string;
        stage?: string;
        projectType?: string;
        polygon?: unknown;
        boundaryType?: string;
        source?: string;
        sourceDatasetId?: string;
        sourceKey?: string;
        asOfDate?: string | null;
      }>;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    const items = Array.isArray(body.items) ? body.items : [];
    return this.service.bulkUpsertFromSource(items);
  }
}
