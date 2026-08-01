import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Not, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { ActualTradeRow } from "./entities/actual-trade.entity";
import { AuctionTradeMatchRow } from "./entities/auction-trade-match.entity";
import { TradeIngestionService } from "./trade-ingestion.service";
import {
  classifyTier,
  computeScore,
  isAmbiguous,
  parseAuctionExclusiveArea,
  parseAuctionFloor,
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
        err instanceof Error ? err.stack : undefined,
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

    // 이 기능의 목적은 "실제로 낙찰된 그 물건"이 되팔렸는지 확인하는
    // 것이라, 층이 다른 실거래는 애초에 다른 호실이므로 후보 자체가
    // 될 수 없다(사용자 요청, 2026-07-28 — 이전엔 인접층까지 감점 후
    // 후보로 남겨 스코어링했으나, 그 결과 다른 층 매물이 최상위
    // 후보와 거의 동점을 만들어 애매 판정을 유발하는 문제가 있었다).
    // 경매 물건의 층을 특정할 수 없으면 검증 불가능하므로 아예
    // 매칭을 시도하지 않는다.
    const auctionFloor = parseAuctionFloor(auction.address);
    if (auctionFloor == null) return;

    const windowStart = new Date();
    windowStart.setMonth(windowStart.getMonth() - CANDIDATE_WINDOW_MONTHS);

    const candidates = await this.tradeRepo
      .createQueryBuilder("t")
      .where("t.lawdCd = :lawdCd", { lawdCd: auction.lawdCd })
      .andWhere("t.umdNm = :umdNm", { umdNm: auction.umdNm })
      .andWhere("t.jibun = :jibun", { jibun: auction.jibun })
      .andWhere("t.isCancelled = false")
      .andWhere("t.floor = :floor", { floor: auctionFloor })
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

    // 이전 배치 실행에서 저장된 후보 중 이번엔 조건에 안 맞아 빠진
    // 것들을 정리한다 — 그대로 두면 QA 화면/조회에서 낡은 후보와 새
    // 후보가 섞여 candidateRank가 중복되는 등 혼란을 준다(실측,
    // 2026-07-28 — 층 하드필터 도입 직후 이전 실행의 인접층 후보가
    // 안 지워지고 남아있던 것을 발견).
    const currentTradeIds = candidates.map((c) => c.id);
    await this.matchRepo.delete(
      currentTradeIds.length > 0
        ? { auctionId: auction.id, actualTradeId: Not(In(currentTradeIds)) }
        : { auctionId: auction.id },
    );

    if (candidates.length === 0) return;

    // 3.4절 고유성 보정 — 이제 층까지 하드필터로 고정되므로(같은 주소·
    // 같은 층·같은 면적) "몇 세대에 걸쳐 후보가 퍼져 있는가"가 아니라
    // "이 정확히 같은 호실 조건에 거래 기록이 몇 건 잡히는가"가 애매성의
    // 척도가 된다 — 1건뿐이면 고유성 만점, 여러 건(재거래·중복 신고 등)
    // 이면 그만큼 확신도를 낮춘다.
    const candidateUnitCount = Math.max(1, candidates.length);

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

  /**
   * 물건작업 화면(검색 페이지)에서 이미 필터링해 놓은 물건 ID 목록을
   * 그대로 받아, 그중 실제로 낙찰된(salePrice 확정) 물건들이 매도분석
   * 로직상 얼마나 매도로 연결됐는지 통계를 낸다(사용자 요청,
   * 2026-08-01). 지역/물건종류 필터 로직을 백엔드에 중복 구현하지
   * 않고, 검색 페이지가 이미 계산해 둔 필터 결과(auctionIds)를 그대로
   * 재사용하는 구조 — "굳이 화면을 나누지 말고 물건작업 필터에서 바로
   * 되게 하자"는 사용자 결정에 따름.
   */
  async getResaleStatsForAuctionIds(auctionIds: string[]) {
    if (auctionIds.length === 0) {
      return { total: 0, withCandidate: 0, displayed: 0, items: [] };
    }
    const soldAuctions = await this.auctionRepo
      .createQueryBuilder("a")
      .where("a.id IN (:...ids)", { ids: auctionIds })
      .andWhere("a.salePrice IS NOT NULL")
      .andWhere("a.salePrice > 0")
      .getMany();
    return this.buildResaleStats(soldAuctions);
  }

  /**
   * 물건작업창(CrawlerWorkPanel)에서 "주소 추가"로 가져온 사건번호
   * 목록을 그대로 받아 매도분석한다 — 그 시점엔 아직 auctionId(UUID)를
   * 모르고 탱크옥션 사건번호(예: "2023타경25614")만 있으므로 사건번호
   * 기준으로 조회한다. 낙찰 안 된 물건은 자동으로 제외된다(salePrice
   * 없는 건 buildResaleStats에서 걸러짐 — 사용자 요청: "낙찰된게
   * 아니면 매도분석하지 않고 낙찰된것만 분석").
   */
  async getResaleStatsForAuctionNos(auctionNos: string[]) {
    if (auctionNos.length === 0) {
      return { total: 0, withCandidate: 0, displayed: 0, items: [] };
    }
    const soldAuctions = await this.auctionRepo
      .createQueryBuilder("a")
      .where("a.auctionNo IN (:...nos)", { nos: auctionNos })
      .andWhere("a.salePrice IS NOT NULL")
      .andWhere("a.salePrice > 0")
      .getMany();
    return this.buildResaleStats(soldAuctions);
  }

  private async buildResaleStats(filtered: Auction[]) {
    if (filtered.length === 0) {
      return { total: 0, withCandidate: 0, displayed: 0, items: [] };
    }

    // 표시 대상(70점+·비애매)이 아니어도 QA 후보(55점+)가 있으면
    // "매도로 이어졌을 가능성이 있는" 물건으로 함께 집계한다 —
    // Auction.resaleMatchTier는 표시 대상만 캐싱되어 있어 그것만 보면
    // 과소집계된다.
    const filteredIds = filtered.map((a) => a.id);
    const topCandidates = await this.matchRepo.query(
      `
        SELECT m."auctionId", m."scoreTotal", m."confidenceTier", m."isDisplayed"
        FROM auction_trade_match m
        WHERE m."candidateRank" = 1 AND m."auctionId" = ANY($1)
      `,
      [filteredIds],
    );
    interface TopCandidateRow {
      auctionId: string;
      scoreTotal: number;
      confidenceTier: string;
      isDisplayed: boolean;
    }
    const candidateByAuctionId = new Map<string, TopCandidateRow>(
      (topCandidates as TopCandidateRow[]).map((row) => [row.auctionId, row]),
    );

    const items = filtered.map((a) => {
      const candidate = candidateByAuctionId.get(a.id);
      return {
        id: a.id,
        auctionNo: a.auctionNo,
        court: a.court,
        address: a.address,
        city: a.city,
        district: a.district,
        usage: a.usage,
        salePrice: a.salePrice,
        candidateScore: candidate?.scoreTotal ?? null,
        candidateTier: candidate?.confidenceTier ?? null,
        displayed: candidate?.isDisplayed ?? false,
      };
    });

    const withCandidate = items.filter((i) => i.candidateScore != null && i.candidateScore >= 55).length;
    const displayed = items.filter((i) => i.displayed).length;

    return { total: items.length, withCandidate, displayed, items };
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
