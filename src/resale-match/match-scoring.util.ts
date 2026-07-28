import type { Auction } from "../auctions/auction.entity";
import type { ActualTradeRow } from "./entities/actual-trade.entity";

/** 설계: docs/auction-resale-matching-design.md 4장. 순수 함수 위주로
 * 구성해 유닛 테스트와 가중치 튜닝이 쉽도록 한다. */

export type ScoreBreakdown = {
  areaScore: number;
  floorScore: number;
  timeScore: number;
  priceScore: number;
  uniquenessScore: number;
  listingLinkScore: number | null;
  baseScore: number;
  penalties: Array<{ name: string; factor: number; reason: string }>;
  finalScore: number;
  isPreCompletion: boolean;
};

export type ConfidenceTier = "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";

const WEIGHTS = {
  area: 0.25,
  floor: 0.2,
  time: 0.15,
  price: 0.15,
  uniqueness: 0.15,
  listingLink: 0.1,
};

const TIME_DECAY_MONTHS = 12;
/** 정상 시세 변동 허용 범위(수익률) — 이 안이면 PriceScore 만점. */
const PRICE_PLAUSIBLE_MIN = -0.15;
const PRICE_PLAUSIBLE_MAX = 0.6;

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Auction.area는 자유 텍스트("101.8427", "84.98㎡" 등) — 선행 숫자만 추출. */
export function parseAuctionExclusiveArea(area: string): number | null {
  const match = (area ?? "").match(/[\d]+(\.[\d]+)?/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** auction 주소 텍스트에서 층수를 추출한다(예: "...12층1203호" → 12).
 * 이미 크롤러 주소 파싱 유틸이 있다면 재사용하는 게 이상적이나, 이
 * 함수는 스코어링 계층의 의존성을 최소화하기 위해 자체적으로 가볍게
 * 처리한다. */
export function parseAuctionFloor(address: string): number | null {
  const match = (address ?? "").match(/(\d+)\s*층/);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

function areaScore(auctionArea: number, tradeArea: number, areaTypeMatched: boolean): number {
  if (areaTypeMatched) return 1;
  const diff = Math.abs(auctionArea - tradeArea);
  return clamp01(1 - diff / 0.5);
}

// 층은 이제 후보 조회 단계(resale-match.service.ts의 하드필터)에서 이미
// 정확히 일치하는 것만 넘어온다 — 낙찰된 "그 물건"인지를 보는 게 목적이라
// 인접층 매물은 애초에 다른 호실이므로 후보가 될 수 없다(사용자 요청,
// 2026-07-28). 여기 도달했다면 항상 일치하지만, 방어적으로 재확인한다.
function floorScore(auctionFloor: number | null, tradeFloor: number | null): number {
  if (auctionFloor == null || tradeFloor == null) return 0;
  return auctionFloor === tradeFloor ? 1 : 0;
}

function timeScore(anchorDate: Date, contractDate: Date): number {
  const months =
    (contractDate.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24 * 30.44);
  if (months < 0) return 0; // 완납 전 계약은 별도 페널티(4.2)에서 처리, 여기선 0 취급 안 함 방지용 최소값
  return clamp01(Math.exp(-months / TIME_DECAY_MONTHS));
}

function priceScore(bidPrice: number, dealAmount: number): number {
  if (bidPrice <= 0) return 0.5; // 낙찰가 정보 없음 — 중립값
  const yieldRate = (dealAmount - bidPrice) / bidPrice;
  if (yieldRate >= PRICE_PLAUSIBLE_MIN && yieldRate <= PRICE_PLAUSIBLE_MAX) return 1;
  const overshoot =
    yieldRate < PRICE_PLAUSIBLE_MIN
      ? PRICE_PLAUSIBLE_MIN - yieldRate
      : yieldRate - PRICE_PLAUSIBLE_MAX;
  return clamp01(1 - overshoot);
}

/** 설계 3.4절 — 후보가 특정될수록(단지 내 유일할수록) 점수가 오른다. */
export function uniquenessScore(candidateUnitCount: number): number {
  return 1 / Math.max(1, candidateUnitCount);
}

export type ScoreInput = {
  auction: Pick<Auction, "area" | "address" | "minPrice" | "salePrice" | "paymentCompletedAt">;
  trade: Pick<
    ActualTradeRow,
    "exclusiveArea" | "floor" | "contractDate" | "dealAmount" | "buildingDong"
  >;
  /** 3.4절 사전확률 보정용 — 같은 단지·같은 면적·같은 층 후보 세대 수. */
  candidateUnitCount: number;
  /** 4.1절 — 있으면 계산, 없으면 가중치 재정규화(설계 4.1 표 각주). */
  listingLinkScore?: number | null;
  areaTypeMatched?: boolean;
  auctionBuildingDong?: string | null;
  paymentCompletedAtIsFallback?: boolean;
};

export function computeScore(input: ScoreInput): ScoreBreakdown {
  const {
    auction,
    trade,
    candidateUnitCount,
    listingLinkScore = null,
    areaTypeMatched = false,
    auctionBuildingDong = null,
    paymentCompletedAtIsFallback = false,
  } = input;

  const auctionArea = parseAuctionExclusiveArea(auction.area) ?? trade.exclusiveArea;
  const auctionFloor = parseAuctionFloor(auction.address);
  const bidPrice = auction.salePrice ?? auction.minPrice ?? 0;

  const anchorDateStr = auction.paymentCompletedAt;
  const anchor = anchorDateStr ? new Date(anchorDateStr) : null;
  const contract = new Date(trade.contractDate);

  const aScore = areaScore(auctionArea, trade.exclusiveArea, areaTypeMatched);
  const fScore = floorScore(auctionFloor, trade.floor);
  const tScore = anchor ? timeScore(anchor, contract) : 0.5;
  const pScore = priceScore(bidPrice, trade.dealAmount);
  const uScore = uniquenessScore(candidateUnitCount);

  const hasListingLink = listingLinkScore != null;
  const weights = hasListingLink
    ? WEIGHTS
    : (() => {
        const remaining = 1 - WEIGHTS.listingLink;
        return {
          area: WEIGHTS.area / remaining,
          floor: WEIGHTS.floor / remaining,
          time: WEIGHTS.time / remaining,
          price: WEIGHTS.price / remaining,
          uniqueness: WEIGHTS.uniqueness / remaining,
          listingLink: 0,
        };
      })();

  const baseScore =
    weights.area * aScore +
    weights.floor * fScore +
    weights.time * tScore +
    weights.price * pScore +
    weights.uniqueness * uScore +
    weights.listingLink * (listingLinkScore ?? 0);

  const penalties: ScoreBreakdown["penalties"] = [];
  let factor = 1;

  const isPreCompletion = anchor != null && contract.getTime() < anchor.getTime();
  if (isPreCompletion) {
    factor *= 0.6;
    penalties.push({
      name: "PRE_COMPLETION",
      factor: 0.6,
      reason: "계약일이 매각대금완납일보다 이름",
    });
  }

  if (paymentCompletedAtIsFallback) {
    factor *= 0.95;
    penalties.push({
      name: "COMPLETION_DATE_ESTIMATED",
      factor: 0.95,
      reason: "완납일이 실측값이 아니라 추정치",
    });
  }

  if (auctionBuildingDong && trade.buildingDong) {
    if (auctionBuildingDong === trade.buildingDong) {
      factor *= 1.15;
      penalties.push({ name: "DONG_MATCH", factor: 1.15, reason: "동 일치(확증 신호)" });
    } else {
      factor *= 0;
      penalties.push({ name: "DONG_MISMATCH", factor: 0, reason: "동 불일치(반증 — 즉시 탈락)" });
    }
  }

  const finalScore = Math.round(clamp01(baseScore * factor) * 100);

  return {
    areaScore: aScore,
    floorScore: fScore,
    timeScore: tScore,
    priceScore: pScore,
    uniquenessScore: uScore,
    listingLinkScore,
    baseScore,
    penalties,
    finalScore,
    isPreCompletion,
  };
}

export function classifyTier(score: number): ConfidenceTier {
  if (score >= 85) return "VERY_HIGH";
  if (score >= 70) return "HIGH";
  if (score >= 55) return "MEDIUM";
  return "LOW";
}

/** 설계 4.5절 — 상위 1·2위 점수차가 8점 미만이면 모호한 것으로 보고
 * 등급과 무관하게 강제 비노출한다. */
export function isAmbiguous(sortedScores: number[]): boolean {
  if (sortedScores.length < 2) return false;
  return sortedScores[0] - sortedScores[1] < 8;
}

/** 최종 노출 여부(설계 4.5절): 70점 이상 + 모호하지 않을 때만 사용자
 * 화면에 노출한다. 55~69점은 관리자 QA 큐로만(별도 status 처리, 이
 * 함수는 "일반 사용자 노출" 여부만 판단). */
export function shouldDisplay(score: number, ambiguous: boolean): boolean {
  return score >= 70 && !ambiguous;
}
