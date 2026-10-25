import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { KakaoGeocodeService } from "./kakao-geocode.service";

/** 구역 경계에서 이 거리(m) 이내면 좌표를 저장한다 — 화면(zone-geometry.ts)의 NEAR_BOUNDARY_MAX_M과 같은 값. */
const NEAR_BOUNDARY_MAX_M = 100;
const ZONE_CACHE_MS = 10 * 60_000;
const M_PER_DEG_LAT = 111_320;

type Pt = { lat: number; lng: number };
type ZoneBox = { minLat: number; maxLat: number; minLng: number; maxLng: number; polygon: Pt[] };

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.lat > p.lat !== b.lat > p.lat && p.lng < ((b.lng - a.lng) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lng) hit = !hit;
  }
  return hit;
}

/** 점에서 선분까지 거리(m) — 이 정도 거리에선 위경도를 평면으로 근사해도 오차가 무시할 수준이다. */
function distToSegmentM(p: Pt, a: Pt, b: Pt): number {
  const mLng = M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * mLng, py = (p.lat - a.lat) * M_PER_DEG_LAT;
  const bx = (b.lng - a.lng) * mLng, by = (b.lat - a.lat) * M_PER_DEG_LAT;
  const len2 = bx * bx + by * by;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** 크롤링으로 새로 저장된 서울 빌라 경매물건의 좌표를 서버가 바로 채운다(사용자 요청, 2026-10-25).
 * 예전엔 관리자가 "재개발물건" 탭을 열 때 브라우저가 대신 채웠다. 화면과 같은 기준으로, 재개발 구역 안이거나
 * 경계에서 100m 이내인 물건만 좌표를 저장한다 — 전부 저장하면 지도 데이터가 불필요하게 커진다. */
@Injectable()
export class AuctionZoneCoordService {
  private readonly logger = new Logger(AuctionZoneCoordService.name);
  private zones: ZoneBox[] = [];
  private zonesLoadedAt = 0;

  constructor(
    @InjectRepository(Auction) private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(RedevelopmentZone) private readonly zoneRepo: Repository<RedevelopmentZone>,
    private readonly geocoder: KakaoGeocodeService,
  ) {}

  private async loadZones(): Promise<ZoneBox[]> {
    if (this.zones.length > 0 && Date.now() - this.zonesLoadedAt < ZONE_CACHE_MS) return this.zones;
    const rows = await this.zoneRepo.find({ where: { sourceDatasetId: "jaegebal" }, select: ["id", "polygon"] });
    this.zones = rows
      .filter((z) => Array.isArray(z.polygon) && z.polygon.length >= 3)
      .map((z) => {
        const lats = z.polygon.map((p) => p.lat);
        const lngs = z.polygon.map((p) => p.lng);
        return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLng: Math.min(...lngs), maxLng: Math.max(...lngs), polygon: z.polygon };
      });
    this.zonesLoadedAt = Date.now();
    return this.zones;
  }

  private isNearAnyZone(p: Pt, zones: ZoneBox[]): boolean {
    const dLat = NEAR_BOUNDARY_MAX_M / M_PER_DEG_LAT;
    const dLng = NEAR_BOUNDARY_MAX_M / (M_PER_DEG_LAT * Math.cos((p.lat * Math.PI) / 180));
    for (const z of zones) {
      if (p.lat < z.minLat - dLat || p.lat > z.maxLat + dLat || p.lng < z.minLng - dLng || p.lng > z.maxLng + dLng) continue;
      if (inside(p, z.polygon)) return true;
      for (let i = 0; i < z.polygon.length; i++) {
        if (distToSegmentM(p, z.polygon[i], z.polygon[(i + 1) % z.polygon.length]) <= NEAR_BOUNDARY_MAX_M) return true;
      }
    }
    return false;
  }

  /** 좌표가 없는 서울 빌라 물건이면 주소를 좌표로 바꿔, 구역 근처일 때만 저장한다. 실패해도 크롤링에는 영향이 없다. */
  async fillIfNeeded(auction: Auction): Promise<boolean> {
    if (auction.latitude != null || auction.propType !== "빌라" || !auction.address) return false;
    if (!(auction.city ?? "").startsWith("서울")) return false;
    try {
      const geo = await this.geocoder.geocode(auction.address);
      if (!geo) return false;
      if (!this.isNearAnyZone({ lat: geo.lat, lng: geo.lng }, await this.loadZones())) return false;
      await this.auctionRepo.update(auction.id, { latitude: geo.lat, longitude: geo.lng });
      return true;
    } catch (err) {
      this.logger.warn(`경매물건 좌표 채우기 실패(${auction.auctionNo}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
