import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Brackets, In, IsNull, Not, Repository } from "typeorm";
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

/** 크롤링으로 새로 저장된 경매물건의 좌표를 서버가 바로 채운다(사용자 요청, 2026-10-25).
 * 예전엔 관리자가 "재개발물건" 탭을 열 때 브라우저가 대신 채웠다. 2026-11-08부터는 구역 근처가 아니어도 좌표를 전부 저장하고,
 * 재개발 구역 안이거나 경계 100m 이내인지는 `nearZone` 표시로 따로 남긴다(지도는 nearZone=true인 물건만 가져온다). */
export type CoordBackfillStatus = {
  running: boolean;
  total: number;
  done: number;
  saved: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class AuctionZoneCoordService implements OnModuleInit {
  private readonly logger = new Logger(AuctionZoneCoordService.name);
  private zones: ZoneBox[] = [];
  private zonesLoadedAt = 0;
  /** 서울 밖에 구역이 있는 시(예: 부천시) — 이 시의 경매물건은 좌표를 채운다. */
  private outsideCities = new Set<string>();
  private backfill: CoordBackfillStatus = { running: false, total: 0, done: 0, saved: 0, startedAt: null, finishedAt: null, error: null };

  private refreshing = false;

  constructor(
    @InjectRepository(Auction) private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(RedevelopmentZone) private readonly zoneRepo: Repository<RedevelopmentZone>,
    private readonly geocoder: KakaoGeocodeService,
  ) {}

  private async loadZones(): Promise<ZoneBox[]> {
    if (this.zones.length > 0 && Date.now() - this.zonesLoadedAt < ZONE_CACHE_MS) return this.zones;
    // 구역 근처 판정은 지도에 보이는 모든 구역(재개발닷컴 외 구역 포함)을 기준으로 한다.
    const rows = await this.zoneRepo.find({ select: ["id", "polygon"] });
    // 지역명(예: "부천시 소사구")에서 서울 밖 시 이름을 뽑는다.
    const cityRows = await this.zoneRepo.find({ where: { sourceDatasetId: "jaegebal" }, select: ["id", "region"] });
    // 인천은 지역명이 "인천 미추홀구"처럼 시/군으로 끝나지 않아 "인천"으로 따로 잡는다(사용자 요청 2026-11-07). 주소의 "인천광역시"에도 포함된다.
    this.outsideCities = new Set(cityRows.map((z) => ((z.region ?? "").startsWith("인천") ? "인천" : /([가-힣]+[시군])/.exec(z.region ?? "")?.[1])).filter((c): c is string => !!c && !c.startsWith("서울")));
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

  /** 서버가 시작될 때 아직 한 건도 계산되지 않았으면(처음 배포) 백그라운드로 한 번 계산한다. */
  async onModuleInit() {
    try {
      const flagged = await this.auctionRepo.count({ where: { nearZone: true } });
      if (flagged === 0) void this.refreshNearZoneFlags().catch((e) => this.logger.error(`구역 근처 표시 초기 계산 실패: ${e}`));
    } catch (e) {
      this.logger.error(`구역 근처 표시 확인 실패: ${e}`);
    }
  }

  /** 좌표가 있는 모든 경매물건의 "구역 안/경계 100m 이내" 표시를 지금 구역 기준으로 다시 계산한다(사이트 호출 없음, 저장된 좌표만 사용).
   * 구역이 새로 생기거나 경계가 바뀐 뒤, 크롤링 저장 시, 서버 시작 시에 호출된다. 바뀐 물건만 갱신한다. */
  async refreshNearZoneFlags(): Promise<{ checked: number; nowOn: number; nowOff: number }> {
    if (this.refreshing) return { checked: 0, nowOn: 0, nowOff: 0 };
    this.refreshing = true;
    try {
      this.zonesLoadedAt = 0; // 구역을 새로 읽는다
      const zones = await this.loadZones();
      const rows = await this.auctionRepo.find({ where: { latitude: Not(IsNull()), longitude: Not(IsNull()) }, select: ["id", "latitude", "longitude", "nearZone"] });
      const turnOn: string[] = [];
      const turnOff: string[] = [];
      for (const a of rows) {
        const near = this.isNearAnyZone({ lat: a.latitude as number, lng: a.longitude as number }, zones);
        if (near && !a.nearZone) turnOn.push(a.id);
        else if (!near && a.nearZone) turnOff.push(a.id);
      }
      for (let i = 0; i < turnOn.length; i += 500) await this.auctionRepo.update({ id: In(turnOn.slice(i, i + 500)) }, { nearZone: true });
      for (let i = 0; i < turnOff.length; i += 500) await this.auctionRepo.update({ id: In(turnOff.slice(i, i + 500)) }, { nearZone: false });
      this.logger.log(`경매물건 구역 근처 표시 갱신: 확인 ${rows.length}건 · 새로 켬 ${turnOn.length} · 끔 ${turnOff.length}`);
      return { checked: rows.length, nowOn: turnOn.length, nowOff: turnOff.length };
    } finally {
      this.refreshing = false;
    }
  }

  getBackfillStatus(): CoordBackfillStatus {
    return this.backfill;
  }

  /** 좌표가 없는 기존 서울 빌라 물건 전부를 서버에서 한 번 훑어 구역 근처인 것만 좌표를 채운다(백그라운드).
   * 크롤링 시점 처리(fillIfNeeded)가 생기기 전에 저장된 물건과, 연결되지 않았던 경로의 물건을 메우는 용도다.
   * 이미 진행 중이면 현재 상태만 돌려준다. */
  async startBackfill(): Promise<CoordBackfillStatus> {
    if (this.backfill.running) return this.backfill;
    await this.loadZones();
    // 지역·용도 제한 없이 좌표가 아직 없는 주소 있는 물건 전부(구역 근처 여부는 저장하면서 nearZone으로 표시).
    const qb = this.auctionRepo.createQueryBuilder("a").where("a.latitude IS NULL").andWhere("a.address IS NOT NULL").andWhere("a.address <> ''");
    const rows = await qb.getMany();
    this.backfill = { running: true, total: rows.length, done: 0, saved: 0, startedAt: new Date().toISOString(), finishedAt: null, error: null };
    void this.runBackfill(rows);
    return this.backfill;
  }

  private async runBackfill(rows: Auction[]): Promise<void> {
    try {
      let idx = 0;
      const worker = async () => {
        while (idx < rows.length) {
          const a = rows[idx++];
          try {
            if (await this.fillIfNeeded(a)) this.backfill.saved += 1;
          } catch {
            // 한 건 실패는 건너뛴다(fillIfNeeded가 이미 로그를 남긴다).
          }
          this.backfill.done += 1;
          await sleep(120);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
    } catch (e) {
      this.backfill.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.backfill.running = false;
      this.backfill.finishedAt = new Date().toISOString();
      this.logger.log(`경매물건 좌표 일괄 채우기 종료: ${this.backfill.saved}건 저장 / ${this.backfill.done}건 처리 (대상 ${this.backfill.total}건)`);
    }
  }

  /** 좌표가 없는 물건이면 지역·용도와 상관없이 주소를 좌표로 바꿔 저장하고, 구역 근처인지는 nearZone으로 표시한다(사용자 결정 2026-11-08). 실패해도 크롤링에는 영향이 없다. */
  async fillIfNeeded(auction: Auction): Promise<boolean> {
    if (auction.latitude != null || !auction.address) return false;
    try {
      const geo = await this.geocoder.geocode(auction.address);
      if (!geo) return false;
      // 구역 근처가 아니어도 좌표는 저장한다(나중에 구역이 생기면 다시 변환 없이 바로 매칭). 근처 여부만 표시해 둔다.
      const near = this.isNearAnyZone({ lat: geo.lat, lng: geo.lng }, await this.loadZones());
      await this.auctionRepo.update(auction.id, { latitude: geo.lat, longitude: geo.lng, nearZone: near });
      return true;
    } catch (err) {
      this.logger.warn(`경매물건 좌표 채우기 실패(${auction.auctionNo}): ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
