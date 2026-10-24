import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { HousingOfficialPrice } from "../housing-price/entities/housing-official-price.entity";
import { MolitTradeClientService, MolitTradeItem } from "../resale-match/molit-trade-client.service";
import { RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { RedevelopmentNaverListing } from "./entities/redevelopment-naver-listing.entity";
import { RedevelopmentResearchRun, ResearchRunStatus } from "./entities/redevelopment-research-run.entity";
import { RedevelopmentTrade } from "./entities/redevelopment-trade.entity";
import { centroid, distanceToZoneM } from "./geo.util";
import { KakaoGeocodeService } from "./kakao-geocode.service";
import { NaverLandService, NaverVillaComplex, VILLA_REAL_ESTATE_TYPES } from "./naver-land.service";

/** 시험/디버깅용으로만 쓰는 상한 조절 — 로컬에서 네이버 호출을 1~3건 수준으로 줄여 확인할 때(samsam 규칙 1). 운영은 기본값. */
function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** 조사에 저장하는 최대 경계 오차(m). 화면의 오차범위(<= 이 값)는 저장된 원본을 다시 거르기만 한다 —
 * 네이버를 다시 부르지 않는다(samsam 규칙 3: 한 번 넉넉히 가져와 저장 후 로컬 필터링). */
export const MAX_TOLERANCE_M = 100;
/** 한 번 실행에 상세를 가져올 최대 매물 수(samsam BACKFILL_BATCH_LIMIT과 같은 이유 — 장시간 규칙적 트래픽 방지).
 * 남으면 "이어서 수집"으로 다시 실행한다. */
const DETAIL_BATCH_LIMIT = envInt("REDEV_RESEARCH_DETAIL_LIMIT", 40);
/** 동 하나당 목록 최대 페이지(20건/페이지 → 600건, samsam villaNearby는 30페이지 상한). */
const MAX_LIST_PAGES = envInt("REDEV_RESEARCH_MAX_LIST_PAGES", 30);
const TRADE_MONTHS = 12;
/** 실거래는 "최근 1년 이내, 가장 최근 거래부터" 이 개수만큼만 샘플로 가져온다(사용자 요청 2026-10-24: 10건으로 시작해 점차 늘림).
 * 구역 안 거래(해제 건 제외)가 이 개수에 닿으면 이전 달은 더 조회하지 않는다 — 국토부 호출도 그만큼 줄어든다. */
const TRADE_SAMPLE_LIMIT = envInt("REDEV_RESEARCH_TRADE_LIMIT", 10);
/** 조사 대상 용도: 빌라 = 다세대 · 연립주택 · 도시형생활주택(경매코치도 이 셋을 "빌라"로 묶는다 — property-type-alias).
 * 국토부 응답의 houseType이 이 목록이거나 비어 있으면(구분 불명) 통과시킨다. 사용자 요청 2026-10-25. */
const VILLA_HOUSE_TYPES = ["다세대", "연립", "연립주택", "도시형생활주택", "도시형"];
function isVillaHouseType(houseType: string | undefined): boolean {
  const v = String(houseType ?? "").trim();
  return !v || VILLA_HOUSE_TYPES.some((t) => v.includes(t));
}
const STALE_RUN_MS = 20 * 60 * 1000;
const MAX_CONSECUTIVE_DETAIL_FAILURES = 3;
const MAX_CONSECUTIVE_FIN_FAILURES = 3;

export type ZoneDong = { code: string; name: string; gu: string; sido: string; sample: { lat: number; lng: number } };

/** 공시가 추정에 근거로 쓴 건물 내 호(후보) 정보 — 화면에서 "왜 이렇게 추정했는지" 확인용. */
export type OfficialPriceRow = { ho: string; dong: string; area: number | null; manwon: number; floor: number | null; used: boolean };

export type OfficialPriceEstimate = {
  manwon: number | null;
  candidates: number;
  basis: "ho" | "floor+area" | "band+area" | "near+area" | "area" | "none";
  /** 이 건물의 공시가격 데이터 총 호수(면적 필터 전) — 0이면 건물 자체가 공시가격 DB에 없다. */
  buildingRowCount: number;
  /** 면적이 맞는 후보(최대 12개). used=true가 실제 추정에 쓰인 것. */
  rows: OfficialPriceRow[];
};

function pad4(v: string): string {
  return v.replace(/\D/g, "").padStart(4, "0");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRateLimit(e: unknown): boolean {
  return e instanceof Error && /429|Too Many|503|502|504/.test(e.message);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** "5/5" → 5, "B1/3" → -1, "3층" → 3 */
export function parseFloor(floorInfo: string | null | undefined): number | null {
  if (!floorInfo) return null;
  const cur = String(floorInfo).split("/")[0]?.trim() ?? "";
  if (/^b\d*$/i.test(cur) || cur.includes("지하")) return -1;
  const n = Number(cur.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 호수("503")의 층: 3자리 이상이면 앞부분(503→5, 1203→12), 그 이하는 층 정보 없음. */
function floorOfHo(hoNm: string): number | null {
  const s = hoNm.trim();
  // 지하·반지하: "B101", "지층 101", "지하1" 등 → -1 (국토부 실거래 floor도 지하는 -1로 온다).
  if (/^(b|지하|지층|반지하)/i.test(s)) return -1;
  // 층이 앞에 명시된 형식(실측: 대림동 686-9 "1층201"·"2층301", 680-13 "1층비"·"2층에이") — 뒤의 숫자는 호 번호라 층 계산에 쓰지 않는다.
  const explicit = s.match(/^(\d+)\s*층/);
  if (explicit) return Number(explicit[1]);
  const digits = s.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return Number(digits.slice(0, digits.length - 2));
}

/** 네이버 층 표기 "저/중/고 + 전체층"(층수를 숨긴 매물, 예 "중/7")에서 층 구간을 뽑는다. 숫자 층이면 null. */
export function parseFloorBand(floorInfo: string | null | undefined): { band: "저" | "중" | "고"; total: number } | null {
  const m = String(floorInfo ?? "").trim().match(/^(저|중|고)\s*\/\s*(\d+)/);
  return m ? { band: m[1] as "저" | "중" | "고", total: Number(m[2]) } : null;
}

/** 층 구간(저/중/고)에 해당하는 층인지 — 전체층을 3등분(저: 아래 1/3, 중: 가운데, 고: 위 1/3). */
function floorInBand(floor: number, band: { band: "저" | "중" | "고"; total: number }): boolean {
  if (floor <= 0) return false;
  const lowMax = Math.max(1, Math.ceil(band.total / 3));
  const highMin = Math.min(band.total, Math.floor((band.total * 2) / 3) + 1);
  if (band.band === "저") return floor <= lowMax;
  if (band.band === "고") return floor >= highMin;
  return floor > lowMax && floor < highMin;
}

@Injectable()
export class RedevelopmentResearchService {
  private readonly logger = new Logger(RedevelopmentResearchService.name);
  /** 네이버 호출이 겹치지 않게 한 번에 한 구역만 조사한다(NaverLandService 큐도 직렬이지만 사용자에게 명확히 알린다). */
  private runningZoneId: string | null = null;

  constructor(
    @InjectRepository(RedevelopmentZone) private readonly zoneRepo: Repository<RedevelopmentZone>,
    @InjectRepository(Auction) private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(RedevelopmentNaverListing) private readonly listingRepo: Repository<RedevelopmentNaverListing>,
    @InjectRepository(RedevelopmentTrade) private readonly tradeRepo: Repository<RedevelopmentTrade>,
    @InjectRepository(RedevelopmentResearchRun) private readonly runRepo: Repository<RedevelopmentResearchRun>,
    @InjectRepository(HousingOfficialPrice) private readonly priceRepo: Repository<HousingOfficialPrice>,
    private readonly naver: NaverLandService,
    private readonly kakao: KakaoGeocodeService,
    private readonly molit: MolitTradeClientService,
  ) {}

  // ───────────────────────── 진행 상태 ─────────────────────────

  private async patchRun(zoneId: string, patch: Partial<RedevelopmentResearchRun>): Promise<RedevelopmentResearchRun> {
    let run = await this.runRepo.findOne({ where: { zoneId } });
    if (!run) {
      run = this.runRepo.create({
        zoneId,
        status: "idle",
        phase: "",
        error: null,
        naverFetched: 0,
        naverSaved: 0,
        naverDetailDone: 0,
        naverDetailRemaining: 0,
        tradesFetched: 0,
        tradesSaved: 0,
        startedAt: null,
        finishedAt: null,
      });
    }
    Object.assign(run, patch, { updatedAt: new Date() });
    return this.runRepo.save(run);
  }

  async getRun(zoneId: string): Promise<RedevelopmentResearchRun> {
    const run = await this.runRepo.findOne({ where: { zoneId } });
    if (!run) {
      return this.runRepo.create({ zoneId, status: "idle", phase: "", error: null, naverFetched: 0, naverSaved: 0, naverDetailDone: 0, naverDetailRemaining: 0, tradesFetched: 0, tradesSaved: 0, startedAt: null, finishedAt: null, updatedAt: new Date() });
    }
    // 재배포 등으로 프로세스가 죽어 "running"으로 남은 기록은 중단된 것으로 보여준다.
    if (run.status === "running" && (this.runningZoneId !== zoneId) && Date.now() - run.updatedAt.getTime() > STALE_RUN_MS) {
      run.status = "interrupted" as ResearchRunStatus;
    }
    return run;
  }

  // ───────────────────────── 시작 ─────────────────────────

  /** 가까운 순으로 구역 후보를 찾는다(경계 오차범위 포함). 같은 구(region)의 구역만 본다. */
  private async zonesNear(lat: number, lng: number, district: string | null, toleranceM: number): Promise<Array<{ zone: RedevelopmentZone; distanceM: number }>> {
    const zones = district ? await this.zoneRepo.find({ where: { region: district } }) : await this.zoneRepo.find();
    const found: Array<{ zone: RedevelopmentZone; distanceM: number }> = [];
    for (const zone of zones) {
      if (!zone.polygon || zone.polygon.length < 3) continue;
      const lats = zone.polygon.map((p) => p.lat);
      const lngs = zone.polygon.map((p) => p.lng);
      const pad = (toleranceM + 5) / 111_320;
      if (lat < Math.min(...lats) - pad || lat > Math.max(...lats) + pad || lng < Math.min(...lngs) - pad * 1.3 || lng > Math.max(...lngs) + pad * 1.3) continue;
      const d = distanceToZoneM(lat, lng, zone.polygon);
      if (d <= toleranceM) found.push({ zone, distanceM: d });
    }
    return found.sort((a, b) => a.distanceM - b.distanceM);
  }

  async startForAuction(auctionId: string, toleranceM = 30): Promise<{ zoneId: string; zoneName: string; run: RedevelopmentResearchRun }> {
    const auction = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!auction) throw new NotFoundException("경매물건을 찾을 수 없습니다.");
    if (auction.latitude == null || auction.longitude == null) {
      throw new BadRequestException("이 물건은 좌표가 없어 재개발 구역을 찾을 수 없습니다.");
    }
    const near = await this.zonesNear(auction.latitude, auction.longitude, auction.district || null, Math.min(toleranceM, MAX_TOLERANCE_M));
    if (!near.length) throw new BadRequestException("이 물건이 속한 재개발 구역을 찾지 못했습니다(오차범위를 늘려 보세요).");
    const { zone } = near[0];
    const run = await this.startZone(zone.id);
    return { zoneId: zone.id, zoneName: zone.name, run };
  }

  async startZone(zoneId: string): Promise<RedevelopmentResearchRun> {
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException("구역을 찾을 수 없습니다.");
    if (this.runningZoneId) {
      if (this.runningZoneId === zoneId) return this.getRun(zoneId);
      const other = await this.zoneRepo.findOne({ where: { id: this.runningZoneId } });
      throw new BadRequestException(`다른 구역(${other?.name ?? this.runningZoneId}) 조사가 진행 중입니다. 끝난 뒤 다시 눌러 주세요.`);
    }
    this.runningZoneId = zoneId;
    const run = await this.patchRun(zoneId, {
      status: "running",
      phase: "시작",
      error: null,
      naverFetched: 0,
      naverSaved: 0,
      naverDetailDone: 0,
      tradesFetched: 0,
      tradesSaved: 0,
      startedAt: new Date(),
      finishedAt: null,
    });
    void this.runZone(zone)
      .catch(async (e) => {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.error(`구역 조사 실패(${zone.name}): ${message}`);
        await this.patchRun(zoneId, { status: "error", error: message, finishedAt: new Date() }).catch(() => undefined);
      })
      .finally(() => {
        this.runningZoneId = null;
      });
    return run;
  }

  // ───────────────────────── 실행 ─────────────────────────

  private async runZone(zone: RedevelopmentZone): Promise<void> {
    this.logger.log(`구역 조사 시작: ${zone.name} (${zone.id})`);
    const dongs = await this.resolveDongs(zone);
    if (!dongs.length) throw new Error(`구역이 걸친 법정동을 찾지 못했습니다(카카오 지역 조회 실패: ${this.kakao.lastError ?? "응답 없음"}).`);
    this.logger.log(`구역이 걸친 동: ${dongs.map((d) => `${d.name}(${d.code})`).join(", ")}`);

    const errors: string[] = [];
    const warnings: string[] = [];
    try {
      const { failedMonths, attemptedMonths, saved } = await this.collectTrades(zone, dongs);
      if (attemptedMonths > 0 && failedMonths >= attemptedMonths && saved === 0) {
        errors.push(`국토부 실거래 ${attemptedMonths}개월 조회가 전부 실패(호출 한도/일시 오류) — 잠시 후 다시 실행하세요`);
      } else if (failedMonths > 0) {
        warnings.push(`국토부 실거래 ${failedMonths}/${attemptedMonths}개월 조회 실패 — 다시 실행하면 보충됩니다`);
      }
    } catch (e) {
      errors.push(`실거래 수집 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await this.collectNaver(zone, dongs);
    } catch (e) {
      errors.push(`네이버 매물 수집 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
    const message = [...errors, ...warnings].join(" / ") || null;
    await this.patchRun(zone.id, {
      status: errors.length ? "error" : "done",
      phase: errors.length ? "일부 실패" : "완료",
      error: message,
      finishedAt: new Date(),
    });
        this.logger.log(`구역 조사 종료: ${zone.name}${message ? ` (${message})` : ""}`);
  }

  /** 구역 경계의 샘플 점(중심 + 꼭짓점 일부)이 걸치는 법정동을 카카오로 알아낸다. */
  private async resolveDongs(zone: RedevelopmentZone): Promise<ZoneDong[]> {
    const poly = zone.polygon;
    const samples = [centroid(poly)];
    const step = Math.max(1, Math.floor(poly.length / 8));
    for (let i = 0; i < poly.length; i += step) samples.push(poly[i]);
    const byCode = new Map<string, ZoneDong>();
    for (const s of samples) {
      const r = await this.kakao.legalDongAt(s.lat, s.lng);
      if (!r || byCode.has(r.code)) continue;
      byCode.set(r.code, { code: r.code, name: r.name, gu: r.gu, sido: "서울", sample: { lat: s.lat, lng: s.lng } });
    }
    return Array.from(byCode.values());
  }

  // ── 국토부 실거래(최근 1년 이내, 가장 최근 거래부터 TRADE_SAMPLE_LIMIT건 샘플, 빌라) ──

  private async collectTrades(
    zone: RedevelopmentZone,
    dongs: ZoneDong[],
  ): Promise<{ failedMonths: number; attemptedMonths: number; saved: number }> {
    await this.patchRun(zone.id, { phase: "국토부 실거래 수집" });
    const limit = TRADE_SAMPLE_LIMIT;
    const now = new Date();
    const cutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    // 최신 달부터 과거 순서(이번 달 → 12개월 전).
    const months: string[] = [];
    for (let i = 0; i < TRADE_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    const lawdCds = Array.from(new Set(dongs.map((d) => d.code.slice(0, 5))));
    const dongByUmd = new Map(dongs.map((d) => [d.name, d]));

    const geoByKey = new Map<string, { lat: number; lng: number; d: number } | null>();
    const rows: Array<Partial<RedevelopmentTrade>> = [];
    let fetched = 0;
    let valid = 0; // 구역 안(경계 오차 포함)에서 찾은 유효(해제 아님) 거래 수 — 샘플 한도 기준
    let failedMonths = 0;
    let attemptedMonths = 0;
    let consecutiveRateLimited = 0;
    let aborted = false;

    outer: for (const lawdCd of lawdCds) {
      for (const ym of months) {
        // 호출 한도(429)가 연속으로 걸리면 더 두드리지 않고 멈춘다.
        if (aborted || valid >= limit) break outer;
        attemptedMonths += 1;
        let items: MolitTradeItem[] | null = null;
        let lastWasRateLimit = false;
        // data.go.kr는 짧은 시간에 몰리면 429를 준다 — 호출 사이 간격 + 429/5xx면 대기를 늘려 최대 3회 재시도.
        for (let attempt = 0; attempt < 3 && items == null; attempt++) {
          try {
            await sleep(attempt === 0 ? 300 : 1500 * attempt * attempt);
            items = await this.molit.fetchVillaTrades(lawdCd, ym);
          } catch (e) {
            this.logger.warn(`실거래 조회 실패(${lawdCd} ${ym}, ${attempt + 1}/3): ${e instanceof Error ? e.message : String(e)}`);
            lastWasRateLimit = isRateLimit(e);
            if (!lastWasRateLimit) break;
          }
        }
        if (items == null) {
          failedMonths += 1;
          consecutiveRateLimited = lastWasRateLimit ? consecutiveRateLimited + 1 : 0;
          if (consecutiveRateLimited >= 2) aborted = true;
          continue;
        }
        consecutiveRateLimited = 0;

        // 이 달의 후보: 구역이 걸친 동 + 최근 1년 이내, 계약일 최신순.
        const cands = items
          .map((item) => ({
            item,
            dong: dongByUmd.get(String(item.umdNm ?? "").trim()),
            contractDate: `${item.dealYear}-${String(item.dealMonth).padStart(2, "0")}-${String(item.dealDay).padStart(2, "0")}`,
          }))
          .filter((c): c is { item: MolitTradeItem; dong: ZoneDong; contractDate: string } => !!c.dong && new Date(c.contractDate) >= cutoff)
          .filter((c) => isVillaHouseType(c.item.houseType))
          .sort((x, y) => y.contractDate.localeCompare(x.contractDate));
        fetched += cands.length;
        await this.patchRun(zone.id, { phase: `국토부 실거래 ${ym} (구역 안 ${valid}/${limit}건)`, tradesFetched: fetched });

        for (const c of cands) {
          if (valid >= limit) break;
          const jibun = String(c.item.jibun ?? "").trim();
          if (!jibun) continue;
          // 지번(동+번지)마다 한 번만 좌표 변환 → 구역 경계 거리 판정
          const key = `${c.dong.code}|${jibun}`;
          if (!geoByKey.has(key)) {
            const g = await this.kakao.geocode(`${c.dong.sido} ${c.dong.gu} ${c.item.umdNm} ${jibun}`);
            geoByKey.set(key, g ? { lat: g.lat, lng: g.lng, d: distanceToZoneM(g.lat, g.lng, zone.polygon) } : null);
          }
          const g = geoByKey.get(key);
          if (!g || g.d > MAX_TOLERANCE_M) continue;
          const amount = Number(String(c.item.dealAmount ?? "").replace(/[^\d]/g, ""));
          const area = Number(c.item.excluUseAr);
          if (!Number.isFinite(amount) || !Number.isFinite(area)) continue;
          const cancelled = !!String(c.item.cdealType ?? "").trim();
          rows.push({
            zoneId: zone.id,
            lawdCd: String(c.item.sggCd ?? c.dong.code.slice(0, 5)),
            umdNm: String(c.item.umdNm).trim(),
            jibun,
            legalDongCode: c.dong.code,
            buildingName: String(c.item.aptNm ?? "").trim(),
            floor: Number(c.item.floor) || 0,
            exclusiveArea: area,
            landArea: c.item.landAr != null && c.item.landAr !== "" ? Number(c.item.landAr) || null : null,
            buildYear: Number(c.item.buildYear) || null,
            dealAmountManwon: amount,
            contractDate: c.contractDate,
            registeredAt: String(c.item.rgstDate ?? "").trim() || null,
            dealingType: String(c.item.dealingGbn ?? "").trim() || null,
            buyerType: String(c.item.buyerGbn ?? "").trim() || null,
            sellerType: String(c.item.slerGbn ?? "").trim() || null,
            houseType: String(c.item.houseType ?? "").trim() || "RH",
            isCancelled: cancelled,
            cancelledAt: String(c.item.cdealDay ?? "").trim() || null,
            lat: g.lat,
            lng: g.lng,
            distanceToZoneM: g.d,
            rawJson: JSON.stringify(c.item),
            collectedAt: new Date(),
          });
          if (!cancelled) valid += 1; // 해제된 거래는 저장은 하되 샘플 개수에는 세지 않는다.
        }
      }
    }

    let saved = 0;
    for (let i = 0; i < rows.length; i += 100) {
      const batch = rows.slice(i, i + 100);
      await this.tradeRepo.upsert(batch as RedevelopmentTrade[], [
        "zoneId",
        "lawdCd",
        "umdNm",
        "jibun",
        "floor",
        "exclusiveArea",
        "contractDate",
        "dealAmountManwon",
      ]);
      saved += batch.length;
    }
    await this.patchRun(zone.id, {
      tradesFetched: fetched,
      tradesSaved: saved,
      phase: `실거래 수집 완료(최근 거래부터 ${valid}/${limit}건 샘플)`,
    });
    return { failedMonths, attemptedMonths, saved };
  }

  // ── 네이버 매매 매물(samsam 방식) ──

  private async collectNaver(zone: RedevelopmentZone, dongs: ZoneDong[]): Promise<void> {
    await this.patchRun(zone.id, { phase: "네이버 동 코드 확인" });
    // 동 코드: samsam처럼 네이버 /api/cortars(좌표→동)로 확정한다. 실패하면 카카오 법정동코드를 쓴다(같은 10자리 체계).
    const cortars: Array<{ cortarNo: string; dong: ZoneDong }> = [];
    for (const dong of dongs) {
      let cortarNo: string | null = null;
      try {
        cortarNo = await this.naver.cortarNoAt(dong.sample.lat, dong.sample.lng);
      } catch (e) {
        this.logger.warn(`네이버 동 코드 조회 실패(${dong.name}): ${e instanceof Error ? e.message : String(e)}`);
      }
      cortars.push({ cortarNo: cortarNo ?? dong.code, dong });
    }

    const seenArticleNos = new Set<string>();
    let fetched = 0;
    let saved = 0;
    let complete = true;
    for (const { cortarNo, dong } of cortars) {
      const rawAll: any[] = [];
      for (let page = 1; page <= MAX_LIST_PAGES; page++) {
        await this.patchRun(zone.id, { phase: `네이버 매물 목록 ${dong.name} ${page}페이지`, naverFetched: fetched + rawAll.length });
        const { raw, isMoreData, failed } = await this.naver.fetchVillaArticlesPage(cortarNo, page, "매매");
        if (failed) {
          complete = false;
          break;
        }
        if (!raw.length) break;
        rawAll.push(...raw);
        if (!isMoreData) break;
        if (page === MAX_LIST_PAGES) complete = false; // 상한에 걸림 — 더 있을 수 있다
      }
      fetched += rawAll.length;

      const now = new Date();
      // 요청을 빌라(VL)+다세대(DSD)로 좁혔지만, 응답에 다른 유형이 섞여 와도 저장하지 않게 한 번 더 거른다.
      const mapped = rawAll
        .filter((a) => !a.realEstateTypeCode || (VILLA_REAL_ESTATE_TYPES as readonly string[]).includes(a.realEstateTypeCode))
        .map((a) => this.naver.mapArticle(a))
        .filter((m) => m.articleNo);
      const inRange = mapped
        .map((m) => ({ m, d: m.lat != null && m.lng != null ? distanceToZoneM(m.lat, m.lng, zone.polygon) : null }))
        .filter((x): x is { m: (typeof mapped)[number]; d: number } => x.d != null && x.d <= MAX_TOLERANCE_M);
      const existing = inRange.length
        ? await this.listingRepo.find({ where: { zoneId: zone.id, articleNo: In(inRange.map((x) => x.m.articleNo)) } })
        : [];
      const existingByNo = new Map(existing.map((e) => [e.articleNo, e]));
      for (const { m, d } of inRange) {
        seenArticleNos.add(m.articleNo);
        const base = {
          cortarNo,
          tradeType: m.tradeType,
          typeName: m.typeName,
          articleName: m.name,
          priceText: m.priceText,
          priceManwon: m.priceManwon,
          supplyArea: m.supplyAreaM2,
          exclusiveArea: m.exclusiveAreaM2,
          roomCount: m.roomCount,
          ageTag: m.ageTag,
          floorInfo: m.floorInfo,
          direction: m.direction,
          confirmedAt: m.confirmedAt,
          feature: m.feature,
          realtor: m.realtor,
          lat: m.lat,
          lng: m.lng,
          distanceToZoneM: d,
          rawListJson: JSON.stringify(m.raw),
          lastSeenAt: now,
          missCount: 0,
        };
        const prev = existingByNo.get(m.articleNo);
        if (prev) {
          // 상세에서 얻은 값(roomCount 등)을 목록 값으로 덮어쓰지 않는다.
          const { roomCount, ...rest } = base;
          Object.assign(prev, rest, prev.detailFetchedAt ? {} : { roomCount });
          await this.listingRepo.save(prev);
        } else {
          await this.listingRepo.save(this.listingRepo.create({ zoneId: zone.id, articleNo: m.articleNo, ...base, firstSeenAt: now }));
        }
        saved += 1;
      }
      await this.patchRun(zone.id, { naverFetched: fetched, naverSaved: saved });
    }

    // 이번에 끝까지 조회가 성공한 경우에만, 안 보인 매물의 missCount를 올린다(실패한 실행이 정상 매물을 "사라짐"으로 만들지 않게 — samsam).
    if (complete) {
      const stored = await this.listingRepo.find({ where: { zoneId: zone.id } });
      for (const row of stored) {
        if (!seenArticleNos.has(row.articleNo)) {
          row.missCount += 1;
          await this.listingRepo.save(row);
        }
      }
    }

    await this.collectNaverDetails(zone);
  }

  /** 단지정보를 매물 행에 반영한다(정확한 지번 주소·도로명·건물 정보). */
  private applyComplex(row: RedevelopmentNaverListing, info: NaverVillaComplex): void {
    row.complexNumber = info.complexNumber;
    row.complexName = info.name;
    if (info.sector && info.jibun) {
      // 위치 비공개 매물은 새 매물 상세의 주소가 동까지만 나온다 — 단지정보의 지번 주소로 덮어쓴다.
      row.address = [info.city, info.division, info.sector, info.jibun].filter(Boolean).join(" ");
    }
    row.roadAddress = info.roadName ? [info.city, info.division, info.roadName].filter(Boolean).join(" ") : null;
    row.totalHouseholdNumber = info.totalHouseholdNumber;
    row.constructionCompany = info.constructionCompany;
    row.floorAreaRatio = info.floorAreaRatio;
    row.buildingCoverageRatio = info.buildingCoverageRatio;
    row.elevatorCount = info.totalElevatorCount;
    row.totalParkingCount = info.totalParkingCount;
    row.approvalElapsedYear = info.approvalElapsedYear;
    if (!row.useApprovalDate && info.useApprovalDate) row.useApprovalDate = info.useApprovalDate;
    if (!row.buildingYear && info.useApprovalDate && /^\d{4}/.test(info.useApprovalDate)) row.buildingYear = Number(info.useApprovalDate.slice(0, 4));
    row.complexInfoJson = JSON.stringify(info.raw);
  }

  /** 같은 단지를 이미 조회한 매물에서 단지정보를 복사한다(단지당 네이버 호출 1회로 줄이기). */
  private copyComplex(from: RedevelopmentNaverListing, to: RedevelopmentNaverListing): void {
    to.complexNumber = from.complexNumber;
    to.complexName = from.complexName;
    if (from.address && /\d/.test(from.address)) to.address = from.address;
    to.roadAddress = from.roadAddress;
    to.totalHouseholdNumber = from.totalHouseholdNumber;
    to.constructionCompany = from.constructionCompany;
    to.floorAreaRatio = from.floorAreaRatio;
    to.buildingCoverageRatio = from.buildingCoverageRatio;
    to.elevatorCount = from.elevatorCount;
    to.totalParkingCount = from.totalParkingCount;
    to.approvalElapsedYear = from.approvalElapsedYear;
    if (!to.useApprovalDate) to.useApprovalDate = from.useApprovalDate;
    if (!to.buildingYear) to.buildingYear = from.buildingYear;
    to.complexInfoJson = from.complexInfoJson;
  }

  private async collectNaverDetails(zone: RedevelopmentZone): Promise<void> {
    const all = await this.listingRepo.find({ where: { zoneId: zone.id } });
    const eligible = all.filter((r) => r.missCount < 2 && (r.distanceToZoneM ?? 9999) <= MAX_TOLERANCE_M);
    // 새 상세가 필요하거나(detailFetchedAt 없음) 단지정보 보충이 필요한(finFetchedAt 없음) 매물 — 가까운 구역 안쪽부터.
    const pending = eligible
      .filter((r) => !r.detailFetchedAt || !r.finFetchedAt)
      .sort((a, b) => (a.distanceToZoneM ?? 0) - (b.distanceToZoneM ?? 0));
    const batch = pending.slice(0, DETAIL_BATCH_LIMIT);
    // 단지정보를 이미 가진 매물 → 같은 단지는 다시 조회하지 않는다.
    const donors = new Map<number, RedevelopmentNaverListing>();
    for (const r of all) if (r.complexNumber && r.complexInfoJson) donors.set(r.complexNumber, r);

    let done = 0;
    let failures = 0;
    let finFailures = 0;
    for (const row of batch) {
      await this.patchRun(zone.id, {
        phase: `네이버 상세·단지정보 ${done + 1}/${batch.length}`,
        naverDetailDone: done,
        naverDetailRemaining: pending.length - done,
      });

      // ① 매물 상세(new.land) — 아직 안 가져온 매물만
      if (!row.detailFetchedAt) {
        const d = await this.naver.fetchArticleDetail(row.articleNo);
        if (!d.ok) {
          failures += 1;
          if (failures >= MAX_CONSECUTIVE_DETAIL_FAILURES) {
            // 연속 실패 = 차단/인증 문제 가능성 — 더 두드리지 않고 멈춘다(samsam 규칙 2).
            throw new Error(`네이버 상세 조회가 ${failures}회 연속 실패해 중단했습니다. 잠시 후 이어서 수집하세요.`);
          }
          continue;
        }
        failures = 0;
        row.address = d.address;
        row.realtorPhone = d.realtorPhone;
        // 상세의 면적은 소수까지 정확하다(목록 area1/area2는 정수 반올림) — 공시가 면적 매칭에 이 값을 쓴다.
        if (d.exclusiveSpace != null) row.exclusiveArea = d.exclusiveSpace;
        if (d.supplySpace != null) row.supplyArea = d.supplySpace;
        row.pnu = d.pnu;
        row.warrantPriceManwon = d.warrantPriceManwon;
        row.bathroomCount = d.bathroomCount;
        row.householdCount = d.householdCount;
        row.parkingCount = d.parkingCount;
        row.subwayWalkMin = d.subwayWalkMin;
        row.lawUsage = d.lawUsage;
        row.heatMethod = d.heatMethod;
        if (d.roomCount != null) row.roomCount = d.roomCount; // 목록 tagList보다 상세 값이 정확(samsam)
        row.buildingYear = d.buildingYear;
        row.useApprovalDate = d.useApprovalDate;
        row.adminCostManwon = d.administrationCostManwon;
        row.adminCostMemo = d.administrationCostMemo;
        row.moveInText = d.moveInText;
        row.featureDesc = d.featureDesc;
        row.introText = d.introText;
        row.photoUrlsJson = JSON.stringify(d.photoUrls);
        row.rawDetailJson = JSON.stringify(d.raw);
        row.detailFetchedAt = new Date();
        if (d.pnu) {
          // PNU = 법정동코드(10) + 대지구분(1) + 본번(4) + 부번(4) — 좌표 역변환보다 정확한 지번/법정동코드.
          const main = Number(d.pnu.slice(11, 15));
          const sub = Number(d.pnu.slice(15, 19));
          row.legalDongCode = d.pnu.slice(0, 10);
          row.jibun = sub ? `${main}-${sub}` : `${main}`;
        } else if (row.lat != null && row.lng != null && !row.jibun) {
          const j = await this.kakao.jibunAt(row.lat, row.lng);
          row.jibun = j?.jibun ?? null;
          row.legalDongCode = j?.legalDongCode ?? null;
        }
      }

      // ② 신규 화면(fin.land): 정확한 지번·단지번호 + 단지정보. 위치 비공개 매물은 좌표/PNU로 지번을 못 얻으므로 특히 필요하다.
      //    (실측 2026-10-25: 대림동 685-5 매물 — 좌표 변환 지번은 부정확할 수 있으나 article/key는 "685-5"를 정확히 준다.)
      if (!row.finFetchedAt) {
        const key = await this.naver.fetchArticleKey(row.articleNo);
        if (!key) {
          finFailures += 1;
          if (finFailures >= MAX_CONSECUTIVE_FIN_FAILURES) {
            await this.listingRepo.save(row);
            throw new Error(`네이버 단지정보(fin) 조회가 ${finFailures}회 연속 실패해 중단했습니다. 잠시 후 이어서 수집하세요.`);
          }
        } else {
          finFailures = 0;
          if (key.legalDivisionNumber) row.legalDongCode = key.legalDivisionNumber;
          if (key.jibun) row.jibun = key.jibun; // 네이버가 직접 준 지번이 PNU·좌표 변환보다 우선
          row.complexNumber = key.complexNumber;
          let complexOk = !key.complexNumber; // 단지가 없는 매물은 단지 조회가 필요 없다
          if (key.complexNumber) {
            const donor = donors.get(key.complexNumber);
            if (donor && donor.id !== row.id) {
              this.copyComplex(donor, row);
              complexOk = true;
            } else {
              const info = await this.naver.fetchVillaComplex(key.complexNumber);
              if (info) {
                this.applyComplex(row, info);
                donors.set(key.complexNumber, row);
                complexOk = true;
              }
            }
          }
          if (complexOk) row.finFetchedAt = new Date();
        }
      }
      await this.listingRepo.save(row);
      done += 1;
    }
    // 상세를 못 가져온 매물이 있어도 좌표만으로 지번/법정동은 채워 공시가 매칭에 쓴다.
    const withoutJibun = (await this.listingRepo.find({ where: { zoneId: zone.id } })).filter(
      (r) => !r.jibun && r.lat != null && r.lng != null && r.missCount < 2,
    );
    for (const row of withoutJibun) {
      const j = await this.kakao.jibunAt(row.lat as number, row.lng as number);
      if (j) {
        row.jibun = j.jibun;
        row.legalDongCode = j.legalDongCode;
        await this.listingRepo.save(row);
      }
    }
    await this.patchRun(zone.id, { naverDetailDone: done, naverDetailRemaining: Math.max(0, pending.length - done), phase: "네이버 수집 완료" });
  }

  // ───────────────────────── 공시가 추정 ─────────────────────────

  private async loadBuildingPrices(keys: Array<{ legalDongCode: string | null; jibun: string | null }>) {
    const buildings = new Map<string, HousingOfficialPrice[]>();
    const uniq = new Map<string, { sigunguCd: string; bjdongCd: string; main: string; sub: string }>();
    for (const k of keys) {
      if (!k.legalDongCode || !k.jibun || k.legalDongCode.length < 10) continue;
      const [main, sub = "0"] = k.jibun.split("-");
      if (!/^\d+$/.test(main)) continue;
      const id = `${k.legalDongCode}|${main}|${sub}`;
      if (!uniq.has(id)) uniq.set(id, { sigunguCd: k.legalDongCode.slice(0, 5), bjdongCd: k.legalDongCode.slice(5, 10), main, sub });
    }
    for (const [id, b] of uniq) {
      const mains = Array.from(new Set([pad4(b.main), String(Number(b.main))]));
      const subs = Array.from(new Set([pad4(b.sub), String(Number(b.sub))]));
      const rows = await this.priceRepo.find({ where: { sigunguCd: b.sigunguCd, bjdongCd: b.bjdongCd, mainBun: In(mains), subBun: In(subs) } });
      if (!rows.length) {
        buildings.set(id, []);
        continue;
      }
      const latest = rows.reduce((m, r) => (r.stdYear > m ? r.stdYear : m), rows[0].stdYear);
      buildings.set(id, rows.filter((r) => r.stdYear === latest));
    }
    return buildings;
  }

  private estimate(
    rows: HousingOfficialPrice[] | undefined,
    area: number | null,
    floor: number | null,
    ho: string | null,
    areaTol = 0.6,
    floorBand: { band: "저" | "중" | "고"; total: number } | null = null,
  ): OfficialPriceEstimate {
    const empty = (buildingRowCount: number, shown: OfficialPriceRow[] = []): OfficialPriceEstimate => ({
      manwon: null,
      candidates: 0,
      basis: "none",
      buildingRowCount,
      rows: shown,
    });
    if (!rows || !rows.length) return empty(0);
    const toRow = (r: HousingOfficialPrice, used: boolean): OfficialPriceRow => ({
      ho: r.hoNm,
      dong: r.dongNm,
      area: r.exclusiveArea != null ? Number(r.exclusiveArea) : null,
      manwon: Math.round(Number(r.postedPrice) / 10000),
      floor: floorOfHo(r.hoNm),
      used,
    });
    if (ho) {
      const exact = rows.filter((r) => r.hoNm.replace(/\D/g, "") === ho.replace(/\D/g, ""));
      if (exact.length) {
        return { manwon: Math.round(Number(exact[0].postedPrice) / 10000), candidates: exact.length, basis: "ho", buildingRowCount: rows.length, rows: exact.slice(0, 12).map((r) => toRow(r, true)) };
      }
    }
    const byArea = area != null ? rows.filter((r) => r.exclusiveArea != null && Math.abs(Number(r.exclusiveArea) - area) <= areaTol) : [];
    if (!byArea.length) {
      // 면적이 맞는 호가 없으면 건물의 호 목록 일부를 보여줘 원인을 확인할 수 있게 한다(면적 가까운 순).
      const near = area != null
        ? [...rows].filter((r) => r.exclusiveArea != null).sort((x, y) => Math.abs(Number(x.exclusiveArea) - area) - Math.abs(Number(y.exclusiveArea) - area))
        : rows;
      return empty(rows.length, near.slice(0, 8).map((r) => toRow(r, false)));
    }
    // 층 매칭 우선순위: ① 정확한 층(지하는 -1) ② 저/중/고 층 구간 ③ 가장 가까운 층 ④ 면적만.
    //  - 호 이름에서 층을 못 읽는 건물이면 면적만으로 추정한다.
    //  - 실거래 층과 같은 층의 호가 건물에 없을 수 있다(예: 대림동 685-17 — 공시가는 지층·2층·3층뿐인데 실거래는 1층, 1층이 필로티인 경우).
    //    이때는 가장 가까운 층의 호를 쓴다(동률이면 모두). 층 차이는 지하(-1)를 1층 아래로 계산한다.
    //  - 층을 모르는 채로 면적만으로 추정할 땐 지하는 제외한다(지하는 공시가가 훨씬 낮다).
    const floorOf = (r: HousingOfficialPrice) => floorOfHo(r.hoNm);
    const byFloor = floor != null && floor !== 0 ? byArea.filter((r) => floorOf(r) === floor) : [];
    const byBand = !byFloor.length && floorBand ? byArea.filter((r) => {
      const f = floorOf(r);
      return f != null && floorInBand(f, floorBand);
    }) : [];
    let byNear: HousingOfficialPrice[] = [];
    if (!byFloor.length && !byBand.length && floor != null && floor !== 0) {
      const readable = byArea.filter((r) => floorOf(r) != null);
      if (readable.length) {
        const dist = (r: HousingOfficialPrice) => Math.abs((floorOf(r) as number) - floor);
        const best = Math.min(...readable.map(dist));
        byNear = readable.filter((r) => dist(r) === best);
      }
    }
    let used = byFloor.length ? byFloor : byBand.length ? byBand : byNear.length ? byNear : byArea;
    const basis: OfficialPriceEstimate["basis"] = byFloor.length ? "floor+area" : byBand.length ? "band+area" : byNear.length ? "near+area" : "area";
    if (basis === "area" && !(floor != null && floor < 0)) {
      const aboveGround = used.filter((r) => floorOf(r) !== -1);
      if (aboveGround.length) used = aboveGround;
    }
    const shown = byArea.slice(0, 12).map((r) => toRow(r, used.includes(r)));
    return {
      manwon: median(used.map((r) => Math.round(Number(r.postedPrice) / 10000))),
      candidates: used.length,
      basis,
      buildingRowCount: rows.length,
      rows: shown,
    };
  }

  // ───────────────────────── 결과 조회 ─────────────────────────

  async getZoneResults(zoneId: string, toleranceM: number) {
    const tol = Math.max(0, Math.min(MAX_TOLERANCE_M, toleranceM));
    const zone = await this.zoneRepo.findOne({ where: { id: zoneId } });
    if (!zone) throw new NotFoundException("구역을 찾을 수 없습니다.");
    const [listingRows, tradeRows, run] = await Promise.all([
      this.listingRepo.find({ where: { zoneId } }),
      this.tradeRepo.find({ where: { zoneId } }),
      this.getRun(zoneId),
    ]);
    const listings = listingRows.filter((l) => l.missCount < 2 && (l.distanceToZoneM ?? 9999) <= tol);
    const trades = tradeRows.filter((t) => (t.distanceToZoneM ?? 9999) <= tol);
    const prices = await this.loadBuildingPrices([
      ...listings.map((l) => ({ legalDongCode: l.legalDongCode, jibun: l.jibun })),
      ...trades.map((t) => ({ legalDongCode: t.legalDongCode, jibun: t.jibun })),
    ]);
    const keyOf = (code: string | null, jibun: string | null) => {
      if (!code || !jibun) return null;
      const [main, sub = "0"] = jibun.split("-");
      return `${code}|${main}|${sub}`;
    };

    return {
      zone: { id: zone.id, name: zone.name, region: zone.region, stage: zone.stage, projectType: zone.projectType },
      run,
      toleranceM: tol,
      listings: listings
        .map((l) => {
          const floor = parseFloor(l.floorInfo);
          const key = keyOf(l.legalDongCode, l.jibun);
          return {
            id: l.id,
            articleNo: l.articleNo,
            articleName: l.articleName,
            typeName: l.typeName,
            tradeType: l.tradeType,
            priceText: l.priceText,
            priceManwon: l.priceManwon,
            supplyArea: l.supplyArea,
            exclusiveArea: l.exclusiveArea,
            roomCount: l.roomCount,
            floorInfo: l.floorInfo,
            floor,
            direction: l.direction,
            confirmedAt: l.confirmedAt,
            feature: l.feature,
            realtor: l.realtor,
            realtorPhone: l.realtorPhone,
            lat: l.lat,
            lng: l.lng,
            distanceToZoneM: l.distanceToZoneM,
            address: l.address,
            jibun: l.jibun,
            buildingYear: l.buildingYear,
            useApprovalDate: l.useApprovalDate,
            ageTag: l.ageTag,
            adminCostManwon: l.adminCostManwon,
            adminCostMemo: l.adminCostMemo,
            moveInText: l.moveInText,
            featureDesc: l.featureDesc,
            introText: l.introText,
            photoUrls: l.photoUrlsJson ? (JSON.parse(l.photoUrlsJson) as string[]) : [],
            hasDetail: !!l.detailFetchedAt,
            firstSeenAt: l.firstSeenAt,
            lastSeenAt: l.lastSeenAt,
            // 상세 전 면적은 정수 반올림(목록 area2)이라 허용오차를 1.0㎡로 넓힌다.
            officialPrice: this.estimate(key ? prices.get(key) : undefined, l.exclusiveArea, floor, null, l.detailFetchedAt ? 0.6 : 1.0, parseFloorBand(l.floorInfo)),
            complexName: l.complexName,
            complexNumber: l.complexNumber,
            roadAddress: l.roadAddress,
            totalHouseholdNumber: l.totalHouseholdNumber,
            constructionCompany: l.constructionCompany,
            floorAreaRatio: l.floorAreaRatio,
            buildingCoverageRatio: l.buildingCoverageRatio,
            elevatorCount: l.elevatorCount,
            totalParkingCount: l.totalParkingCount,
            approvalElapsedYear: l.approvalElapsedYear,
            pnu: l.pnu,
            warrantPriceManwon: l.warrantPriceManwon,
            bathroomCount: l.bathroomCount,
            householdCount: l.householdCount,
            parkingCount: l.parkingCount,
            subwayWalkMin: l.subwayWalkMin,
            lawUsage: l.lawUsage,
            heatMethod: l.heatMethod,
          };
        })
        .sort((a, b) => (a.priceManwon ?? 0) - (b.priceManwon ?? 0)),
      trades: trades
        .map((t) => {
          const key = keyOf(t.legalDongCode, t.jibun);
          return {
            id: t.id,
            umdNm: t.umdNm,
            jibun: t.jibun,
            buildingName: t.buildingName,
            floor: t.floor,
            exclusiveArea: t.exclusiveArea,
            landArea: t.landArea,
            buildYear: t.buildYear,
            dealAmountManwon: t.dealAmountManwon,
            contractDate: t.contractDate,
            registeredAt: t.registeredAt,
            dealingType: t.dealingType,
            buyerType: t.buyerType,
            sellerType: t.sellerType,
            houseType: t.houseType,
            isCancelled: t.isCancelled,
            cancelledAt: t.cancelledAt,
            distanceToZoneM: t.distanceToZoneM,
            officialPrice: this.estimate(key ? prices.get(key) : undefined, t.exclusiveArea, t.floor, null),
          };
        })
        .sort((a, b) => b.contractDate.localeCompare(a.contractDate)),
    };
  }

  /** 관심 경매물건 기준 조사 결과: 대상 물건 정보(+공시가 추정) + 물건이 속한 구역의 호가·실거래. */
  async getAuctionResearch(auctionId: string, toleranceM = 30) {
    const auction = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!auction) throw new NotFoundException("경매물건을 찾을 수 없습니다.");
    if (auction.latitude == null || auction.longitude == null) {
      return { target: null, zone: null, message: "이 물건은 좌표가 없어 구역을 찾을 수 없습니다." };
    }
    const tol = Math.max(0, Math.min(MAX_TOLERANCE_M, toleranceM));
    const near = await this.zonesNear(auction.latitude, auction.longitude, auction.district || null, tol);
    if (!near.length) return { target: null, zone: null, message: "이 물건이 속한 재개발 구역을 찾지 못했습니다." };

    const floorMatch = auction.address.match(/제?(\d+)층/);
    const hoMatch = auction.address.match(/제?(\d+)호/);
    const floor = floorMatch ? Number(floorMatch[1]) : null;
    const ho = hoMatch ? hoMatch[1] : null;
    const area = Number(String(auction.area ?? "").replace(/[^\d.]/g, "")) || null;
    const j = await this.kakao.jibunAt(auction.latitude, auction.longitude);
    const prices = await this.loadBuildingPrices([{ legalDongCode: j?.legalDongCode ?? null, jibun: j?.jibun ?? null }]);
    const key = j?.legalDongCode && j.jibun ? `${j.legalDongCode}|${j.jibun.split("-")[0]}|${j.jibun.split("-")[1] ?? "0"}` : null;
    const results = await this.getZoneResults(near[0].zone.id, tol);
    return {
      target: {
        id: auction.id,
        auctionNo: auction.auctionNo,
        address: auction.address,
        propType: auction.propType,
        exclusiveArea: area,
        builtYear: auction.builtYear || null,
        floor,
        ho,
        appraisedValue: auction.appraisedValue,
        minPrice: auction.minPrice,
        jibun: j?.jibun ?? null,
        officialPrice: this.estimate(key ? prices.get(key) : undefined, area, floor, ho),
      },
      otherZones: near.slice(1).map((n) => ({ id: n.zone.id, name: n.zone.name, distanceM: n.distanceM })),
      ...results,
    };
  }
}
