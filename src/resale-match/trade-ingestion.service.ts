import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { ActualTradeRow } from "./entities/actual-trade.entity";
import { MolitTradeClientService, MolitTradeItem } from "./molit-trade-client.service";

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
  async resolveIngestionScope(): Promise<Array<{ lawdCd: string; dealYm: string }>> {
    const targets = await this.auctionRepo
      .createQueryBuilder("a")
      .select(["a.lawdCd", "a.bidDate"])
      .where("a.paymentCompletedAt IS NOT NULL")
      .andWhere("a.resaleMatchedTradeId IS NULL")
      .andWhere("a.lawdCd IS NOT NULL")
      .getMany();

    const lawdCds = new Set(targets.map((t) => t.lawdCd).filter((v): v is string => !!v));
    if (lawdCds.size === 0) return [];

    const months = this.recentMonths(this.lookbackMonths);
    const scope: Array<{ lawdCd: string; dealYm: string }> = [];
    for (const lawdCd of lawdCds) {
      for (const dealYm of months) {
        scope.push({ lawdCd, dealYm });
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
   * 가능하게 한다(같은 단지에 여러 물건이 걸릴 수 있음). */
  async ingestOne(lawdCd: string, dealYm: string): Promise<number> {
    let items: MolitTradeItem[];
    try {
      items = await this.molitClient.fetchTrades(lawdCd, dealYm);
    } catch (err) {
      this.logger.error(
        `국토부 API 수집 실패(lawdCd=${lawdCd}, dealYm=${dealYm}): ${
          err instanceof Error ? err.message : err
        }`,
      );
      return 0;
    }

    let saved = 0;
    for (const item of items) {
      try {
        await this.upsertTrade(lawdCd, item);
        saved++;
      } catch (err) {
        this.logger.warn(
          `실거래 저장 실패(lawdCd=${lawdCd}, aptNm=${item.aptNm}): ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return saved;
  }

  private async upsertTrade(lawdCd: string, item: MolitTradeItem): Promise<void> {
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
    });
    await this.tradeRepo.save(row);
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
