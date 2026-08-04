import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, Not, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { RedevelopmentPoint, RedevelopmentZone } from "./entities/redevelopment-zone.entity";

/** 표준 레이 캐스팅(ray casting) 알고리즘 — 점이 다각형 내부에 있는지
 * 판별한다. 꼭짓점이 시계/반시계 어느 방향으로 그려졌든 동작한다. */
function isPointInPolygon(point: { lat: number; lng: number }, polygon: RedevelopmentPoint[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;
    const intersects =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function normalizePolygon(raw: unknown): RedevelopmentPoint[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException("구역 경계(polygon)가 필요합니다.");
  }
  const points = raw
    .map((p) => {
      const lat = Number((p as { lat?: unknown })?.lat);
      const lng = Number((p as { lng?: unknown })?.lng);
      return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
    })
    .filter((p): p is RedevelopmentPoint => p !== null);
  if (points.length < 3) {
    throw new BadRequestException("구역 경계는 최소 3개의 꼭짓점이 필요합니다.");
  }
  return points;
}

@Injectable()
export class RedevelopmentService {
  constructor(
    @InjectRepository(RedevelopmentZone)
    private readonly zoneRepo: Repository<RedevelopmentZone>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
  ) {}

  listZones() {
    return this.zoneRepo.find({ order: { createdAt: "ASC" } });
  }

  async createZone(body: { name?: string; region?: string; stage?: string; memo?: string; polygon?: unknown; color?: string }) {
    const name = body.name?.trim();
    if (!name) throw new BadRequestException("구역명을 입력해주세요.");
    const zone = this.zoneRepo.create({
      name,
      region: body.region?.trim() ?? "",
      stage: body.stage?.trim() ?? "",
      memo: body.memo?.trim() || null,
      polygon: normalizePolygon(body.polygon),
      color: body.color?.trim() || null,
    });
    return this.zoneRepo.save(zone);
  }

  async updateZone(
    id: string,
    body: { name?: string; region?: string; stage?: string; memo?: string; polygon?: unknown; color?: string | null },
  ) {
    const zone = await this.zoneRepo.findOne({ where: { id } });
    if (!zone) throw new NotFoundException("구역을 찾을 수 없습니다.");
    if (body.name !== undefined) zone.name = body.name.trim();
    if (body.region !== undefined) zone.region = body.region.trim();
    if (body.stage !== undefined) zone.stage = body.stage.trim();
    if (body.memo !== undefined) zone.memo = body.memo.trim() || null;
    if (body.polygon !== undefined) zone.polygon = normalizePolygon(body.polygon);
    if (body.color !== undefined) zone.color = body.color?.trim() || null;
    return this.zoneRepo.save(zone);
  }

  async deleteZone(id: string) {
    await this.zoneRepo.delete(id);
    return { ok: true };
  }

  /** 지도 표시용 — 좌표가 확보된 경매물건 전체(매도분석 지도 기능이
   * 이미 지오코딩해 캐싱해 둔 auctions.latitude/longitude를 재사용)에
   * 각 물건이 어느 구역(들)에 포함되는지 계산해 붙여 반환한다. */
  async getMapData() {
    const [zones, auctions] = await Promise.all([
      this.listZones(),
      this.auctionRepo.find({
        where: { latitude: Not(IsNull()), longitude: Not(IsNull()) },
        select: ["id", "auctionNo", "address", "city", "district", "propType", "salePrice", "status", "latitude", "longitude"],
      }),
    ]);

    const auctionsWithZones = auctions.map((a) => {
      const point = { lat: a.latitude as number, lng: a.longitude as number };
      const zoneIds = zones.filter((z) => isPointInPolygon(point, z.polygon)).map((z) => z.id);
      return { ...a, zoneIds };
    });

    return { zones, auctions: auctionsWithZones };
  }

  /** 특정 구역 안에 포함된 경매물건 목록(구역 클릭 시 상세 목록용). */
  async getAuctionsInZone(zoneId: string) {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException("구역을 찾을 수 없습니다.");
    const auctions = await this.auctionRepo.find({
      where: { latitude: Not(IsNull()), longitude: Not(IsNull()) },
      select: ["id", "auctionNo", "court", "address", "city", "district", "propType", "salePrice", "status", "latitude", "longitude"],
    });
    return auctions.filter((a) =>
      isPointInPolygon({ lat: a.latitude as number, lng: a.longitude as number }, zone.polygon),
    );
  }
}
