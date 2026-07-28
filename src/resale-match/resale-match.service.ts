import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { ActualTradeRow } from "./entities/actual-trade.entity";
import { AuctionTradeMatchRow } from "./entities/auction-trade-match.entity";
import { TradeIngestionService } from "./trade-ingestion.service";
import {
  classifyTier,
  computeScore,
  isAmbiguous,
  parseAuctionExclusiveArea,
  shouldDisplay,
} from "./match-scoring.util";

const AREA_TOLERANCE_SQM = 0.5;
const CANDIDATE_WINDOW_MONTHS = 36;

/** 설계 문서 7.2절 — Stage A(수집)+Stage B(매칭)를 순차 실행하는
 * 오케스트레이터. 스케줄러는 기존 CrawlerService와 동일하게
 * setInterval 기반(1일 1회). */
@Injectable()
export class ResaleMatchService implements OnModuleInit {
  private readonly logger = new Logger(ResaleMatchService.name);
  private running = false;

  constructor(
    @InjectRepository(Auction) private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(ActualTradeRow)
    private readonly tradeRepo: Repository<ActualTradeRow>,
    @InjectRepository(AuctionTradeMatchRow)
    private readonly matchRepo: Repository<AuctionTradeMatchRow>,
    private readonly ingestion: TradeIngestionService,
  ) {}

  onModuleInit() {
    // 배포 직후 바로 돌지 않도록 약간의 지연을 둔다(다른 스케줄러들과
    // 동일한 안전장치 패턴 — CrawlerService.onModuleInit 참고).
    const READY_DELAY_MS = 60_000;
    const RUN_INTERVAL_MS = 24 * 60 * 60_000; // 1일
    setTimeout(() => {
      void this.runOnce();
      setInterval(() => void this.runOnce(), RUN_INTERVAL_MS);
    }, READY_DELAY_MS);
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runIngestion();
      await this.runMatching();
    } catch (err) {
      this.logger.error(
        `재판매 매칭 배치 실행 중 오류: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async runIngestion(): Promise<void> {
    const scope = await this.ingestion.resolveIngestionScope();
    if (scope.length === 0) {
      this.logger.log("재판매 매칭: 수집 대상 없음(완납일 확보된 미매칭 물건 없음)");
      return;
    }
    this.logger.log(`재판매 매칭: 실거래 수집 시작(${scope.length}개 시군구×월 조합)`);
    let totalSaved = 0;
    for (const { lawdCd, dealYm } of scope) {
      totalSaved += await this.ingestion.ingestOne(lawdCd, dealYm);
      // data.go.kr 트래픽/레이트 리밋 보호를 위한 최소 지연.
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    this.logger.log(`재판매 매칭: 실거래 수집 완료(신규/갱신 ${totalSaved}건)`);
  }

  private async runMatching(): Promise<void> {
    const pending = await this.auctionRepo
      .createQueryBuilder("a")
      .where("a.paymentCompletedAt IS NOT NULL")
      .andWhere("a.resaleMatchedTradeId IS NULL")
      .andWhere("a.lawdCd IS NOT NULL")
      .andWhere("a.umdNm IS NOT NULL")
      .andWhere("a.jibun IS NOT NULL")
      .getMany();

    if (pending.length === 0) return;
    this.logger.log(`재판매 매칭: 스코어링 대상 ${pending.length}건`);

    for (const auction of pending) {
      await this.matchOne(auction);
    }
  }

  private async matchOne(auction: Auction): Promise<void> {
    const auctionArea = parseAuctionExclusiveArea(auction.area);
    if (auctionArea == null) return;

    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - CANDIDATE_WINDOW_MONTHS);

    const candidates = await this.tradeRepo
      .createQueryBuilder("t")
      .where("t.lawdCd = :lawdCd", { lawdCd: auction.lawdCd })
      .andWhere("t.umdNm = :umdNm", { umdNm: auction.umdNm })
      .andWhere("t.jibun = :jibun", { jibun: auction.jibun })
      .andWhere("t.isCancelled = false")
      .andWhere("ABS(t.exclusiveArea - :area) <= :tolerance", {
        area: auctionArea,
        tolerance: AREA_TOLERANCE_SQM,
      })
      .andWhere("t.contractDate >= :bidDate", {
        bidDate: this.parseBidDate(auction.bidDate) ?? "1900-01-01",
      })
      .andWhere("t.contractDate >= :windowStart", {
        windowStart: windowStart.toISOString().slice(0, 10),
      })
      .getMany();

    if (candidates.length === 0) return;

    // 3.4절 고유성 보정 — 같은 주소·같은 면적대에서 관측된 서로 다른
    // 층 수(이 배치 실행 시점까지 수집된 범위 내 근사치).
    const distinctFloors = new Set(
      candidates.map((c) => c.floor).filter((f): f is number => f != null),
    );
    const candidateUnitCount = Math.max(1, distinctFloors.size || candidates.length);

    const auctionBuildingDong = this.parseAuctionDong(auction.address);

    const scored = candidates.map((trade) => {
      const breakdown = computeScore({
        auction,
        trade,
        candidateUnitCount,
        areaTypeMatched: false,
        auctionBuildingDong,
        paymentCompletedAtIsFallback: auction.paymentCompletedAtIsEstimated,
      });
      return { trade, breakdown };
    });

    scored.sort((a, b) => b.breakdown.finalScore - a.breakdown.finalScore);
    const ambiguous = isAmbiguous(scored.map((s) => s.breakdown.finalScore));

    // 모든 후보를 감사용으로 저장(설계 원칙 — 1등만 저장하지 않음).
    for (let i = 0; i < scored.length; i++) {
      const { trade, breakdown } = scored[i];
      const tier = classifyTier(breakdown.finalScore);
      const isTop = i === 0;
      const displayed = isTop && shouldDisplay(breakdown.finalScore, ambiguous);

      // scoreBreakdown(jsonb, Record<string, unknown>)이 TypeORM의
      // QueryDeepPartialEntity 재귀 추론과 충돌해 페이로드 전체를 any로
      // 우회한다(런타임 동작에는 영향 없음, jsonb 컬럼이라 그대로 저장됨).
      const upsertPayload = {
        auctionId: auction.id,
        actualTradeId: trade.id,
        candidateRank: i + 1,
        scoreTotal: breakdown.finalScore,
        scoreBreakdown: breakdown,
        confidenceTier: tier,
        isPreCompletion: breakdown.isPreCompletion,
        isDisplayed: displayed,
        status: "CANDIDATE",
        computedAt: new Date(),
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await this.matchRepo.upsert(upsertPayload as any, ["auctionId", "actualTradeId"]);

      if (isTop && displayed) {
        await this.auctionRepo.update(auction.id, {
          resaleMatchedTradeId: trade.id,
          resaleMatchScore: breakdown.finalScore,
          resaleMatchTier: tier,
        });
      }
    }
  }

  private parseBidDate(bidDate: string): string | null {
    // bidDate는 "2026.03.04" 형태(탱크옥션 원문) — ISO로 변환.
    const match = (bidDate ?? "").match(/(\d{4})\.(\d{2})\.(\d{2})/);
    if (!match) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
  }

  private parseAuctionDong(address: string): string | null {
    const match = (address ?? "").match(/(\d+)\s*동/);
    return match ? match[1] : null;
  }
}
