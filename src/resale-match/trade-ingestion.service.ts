import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { ActualTradeRow } from "./entities/actual-trade.entity";
import { MolitTradeClientService, MolitTradeItem } from "./molit-trade-client.service";

export type TradeKind = "APT" | "RH" | "OFFI";
export const ALL_TRADE_KINDS: TradeKind[] = ["APT", "RH", "OFFI"];

/** 경매 물건 용도 → 조회할 국토부 실거래 API 종류. 아파트는 아파트매매, 빌라(연립·다세대·
 * 도시형생활주택)는 연립다세대매매, 오피스텔은 오피스텔매매만 필요하다. 처음 보는 용도는
 * 매칭을 놓치지 않도록 세 종류를 모두 조회한다(사용자 요청, 2026-10-25 — 일일 쿼터 절약). */
export function tradeKindsForPropType(propType: string | null | undefined): TradeKind[] {
  const t = (propType ?? "").trim();
  if (t === "아파트") return ["APT"];
  if (t === "빌라") return ["RH"];
  if (t === "오피스텔") return ["OFFI"];
  return ALL_TRADE_KINDS;
}

/** Stage A(설계 문서 7.2절) — 국토부 실거래가 API로 실거래를 수집해
 * actual_trade에 upsert한다. 전국 전체를 매일 훑지 않고, 완납일이
 * 설정된(=매칭 대상) auctions의 (lawdCd, 최근 N개월) 조합만 조회해
 * API 트래픽을 통제한다. */
@Injectable()
export class TradeIngestionService {
  private readonly logger = new Logger(TradeIngestionService.name);

  /** 완납 후 최대 이 개월수까지 감시(설계 7.2절 Stage B 재확인 주기와
   * 별개로, 수집 자체는 이 범위만 커버하면 충분). */
  private readonly lookbackMonths = 36;

  constructor(
    @InjectRepository(Auction) private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(ActualTradeRow)
    private readonly tradeRepo: Repository<ActualTradeRow>,
    private readonly molitClient: MolitTradeClientService,
  ) {}

  /** 수집 대상 (lawdCd, dealYm) 조합을 구한다 — 완납일이 있고 아직
   * CONFIRMED 매칭이 없는 auctions에서 lawdCd를 모으고, 각각 낙찰일부터
   * 현재까지(최대 lookbackMonths)의 월 목록과 곱한다. */
  async resolveIngestionScope(): Promise<Array<{ lawdCd: string; dealYm: string; kinds: TradeKind[] }>> {
    const targets = await this.auctionRepo
      .createQueryBuilder("a")
      .select(["a.lawdCd", "a.bidDate", "a.propType"])
      .where("a.paymentCompletedAt IS NOT NULL")
      .andWhere("a.resaleMatchedTradeId IS NULL")
      .andWhere("a.lawdCd IS NOT NULL")
      .getMany();

    // 지역별로 필요한 실거래 API 종류만 모은다(아파트 물건만 있는 지역은 아파트매매만 조회).
    const kindsByLawd = new Map<string, Set<TradeKind>>();
    for (const t of targets) {
      if (!t.lawdCd) continue;
      const set = kindsByLawd.get(t.lawdCd) ?? new Set<TradeKind>();
      for (const k of tradeKindsForPropType(t.propType)) set.add(k);
      kindsByLawd.set(t.lawdCd, set);
    }
    if (kindsByLawd.size === 0) return [];

    const months = this.recentMonths(this.lookbackMonths);
    const scope: Array<{ lawdCd: string; dealYm: string; kinds: TradeKind[] }> = [];
    for (const [lawdCd, kinds] of kindsByLawd) {
      for (const dealYm of months) {
        scope.push({ lawdCd, dealYm, kinds: ALL_TRADE_KINDS.filter((k) => kinds.has(k)) });
      }
    }
    return scope;
  }

  recentMonths(count: number): string[] {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < count; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return months;
  }

  /** 하나의 (lawdCd, dealYm) 조합을 조회해 actual_trade에 upsert한다.
   * 국토부 API가 시군구+월 전체를 반환하므로, umdNm+jibun이 실제로
   * 우리 관심 단지와 일치하는지는 매칭 단계(Stage B)의 하드필터에서
   * 최종 판단한다 — 여기선 전량 저장해 향후 다른 물건에도 재사용
   * 가능하게 한다(같은 단지에 여러 물건이 걸릴 수 있음).
   *
   * 호출하는 실거래 API는 kinds로 받은 종류만이다. 예전엔 아파트/빌라/오피스텔 세 API를
   * 항상 함께 불렀는데(2026-08-03), 물건 용도와 무관한 API까지 불러 일일 쿼터를 낭비해
   * 용도별로 필요한 것만 부르도록 바꿨다(사용자 요청, 2026-10-25). */
  async ingestOne(lawdCd: string, dealYm: string, kinds: TradeKind[] = ALL_TRADE_KINDS): Promise<number> {
    const want = new Set(kinds);
    const [aptItems, villaItems, officetelItems] = await Promise.all([
      want.has("APT")
        ? this.fetchSafely(() => this.molitClient.fetchTrades(lawdCd, dealYm), "아파트", lawdCd, dealYm)
        : Promise.resolve([] as MolitTradeItem[]),
      want.has("RH")
        ? this.fetchSafely(() => this.molitClient.fetchVillaTrades(lawdCd, dealYm), "빌라", lawdCd, dealYm)
        : Promise.resolve([] as MolitTradeItem[]),
      want.has("OFFI")
        ? this.fetchSafely(() => this.molitClient.fetchOfficetelTrades(lawdCd, dealYm), "오피스텔", lawdCd, dealYm)
        : Promise.resolve([] as MolitTradeItem[]),
    ]);

    let saved = 0;
    for (const item of aptItems) {
      saved += await this.trySaveTrade(lawdCd, item, "APT");
    }
    for (const item of villaItems) {
      saved += await this.trySaveTrade(lawdCd, item, "RH");
    }
    for (const item of officetelItems) {
      saved += await this.trySaveTrade(lawdCd, item, "OFFI");
    }
    return saved;
  }

  private async fetchSafely(
    fn: () => Promise<MolitTradeItem[]>,
    label: string,
    lawdCd: string,
    dealYm: string,
  ): Promise<MolitTradeItem[]> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(
        `국토부 ${label} API 수집 실패(lawdCd=${lawdCd}, dealYm=${dealYm}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return [];
    }
  }

  private async trySaveTrade(
    lawdCd: string,
    item: MolitTradeItem,
    houseType: "APT" | "RH" | "OFFI",
  ): Promise<number> {
    try {
      await this.upsertTrade(lawdCd, item, houseType);
      return 1;
    } catch (err) {
      this.logger.warn(
        `실거래 저장 실패(lawdCd=${lawdCd}, aptNm=${item.aptNm}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return 0;
    }
  }

  private async upsertTrade(
    lawdCd: string,
    item: MolitTradeItem,
    houseType: "APT" | "RH" | "OFFI",
  ): Promise<void> {
    const exclusiveArea = Number(item.excluUseAr);
    if (!Number.isFinite(exclusiveArea) || exclusiveArea <= 0) return;

    const dealAmountWon = this.parseDealAmountWon(item.dealAmount);
    const contractDate = this.formatContractDate(item.dealYear, item.dealMonth, item.dealDay);
    if (!contractDate) return;

    const existing = await this.tradeRepo.findOne({
      where: {
        lawdCd,
        umdNm: item.umdNm,
        jibun: item.jibun,
        floor: item.floor ? Number(item.floor) : undefined,
        exclusiveArea,
        contractDate,
        dealAmount: dealAmountWon,
        houseType,
      },
    });
    if (existing) {
      // 계약 해제(cdealType)는 등록 이후 뒤늦게 반영될 수 있으므로,
      // 기존 행이 있어도 해제 여부는 매번 최신화한다.
      const isCancelled = Boolean(item.cdealType);
      if (existing.isCancelled !== isCancelled) {
        await this.tradeRepo.update(existing.id, {
          isCancelled,
          cancelledAt: item.cdealDay ? this.toIsoDate(item.cdealDay) : null,
        });
      }
      return;
    }

    const row = this.tradeRepo.create({
      lawdCd,
      umdNm: item.umdNm,
      jibun: item.jibun,
      aptNm: item.aptNm,
      buildingDong: item.aptDong?.trim() || null,
      floor: item.floor ? Number(item.floor) : null,
      exclusiveArea,
      dealAmount: dealAmountWon,
      contractDate,
      registeredAt: item.rgstDate ? this.toIsoDate(item.rgstDate) : null,
      buyerType: item.buyerGbn || null,
      sellerType: item.slerGbn || null,
      dealingType: item.dealingGbn || null,
      isCancelled: Boolean(item.cdealType),
      cancelledAt: item.cdealDay ? this.toIsoDate(item.cdealDay) : null,
      sourceType: "MOLIT_API",
      sourceRaw: item,
      houseType,
      landArea: this.parseLandArea(item.landAr),
    });
    await this.tradeRepo.save(row);
  }

  private parseLandArea(raw: string | undefined): number | null {
    if (!raw) return null;
    const num = Number(raw.trim());
    return Number.isFinite(num) && num > 0 ? num : null;
  }

  /** 국토부 API는 만원 단위 문자열("42,000")로 금액을 준다 → 원 단위로. */
  private parseDealAmountWon(raw: string): number {
    const cleaned = (raw ?? "").replace(/,/g, "").trim();
    const num = Number(cleaned);
    return Number.isFinite(num) ? Math.round(num * 10000) : 0;
  }

  private formatContractDate(year: string, month: string, day: string): string | null {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (!y || !m || !d) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  /** "26.05.07" 형태(국토부 rgstDate/cdealDay)를 ISO 날짜로. 연도는
   * 2자리라 2000년대로 가정(2100년 전까지는 안전). */
  private toIsoDate(raw: string): string | null {
    const match = raw.trim().match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
    if (!match) return null;
    const [, yy, mm, dd] = match;
    return `20${yy}-${mm}-${dd}`;
  }
}
