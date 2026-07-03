export interface AuctionItemFeatures {
  priceTier: "소액물건" | null;
  areaTier: "소형평형" | "중형평형" | "대형평형" | null;
  housingType: "공동주택" | null;
  priceMerit: boolean;
  [key: string]: unknown;
}

/** 소액물건 기준(원) — 필요 시 조정 */
export const SMALL_PRICE_THRESHOLD_WON = 50_000_000;

/** 평형 구간(평) */
export const AREA_TIER_BOUNDS = { smallMax: 10, midMax: 34 };

/** 감정가 대비 최저가 비율(%)이 이 값 이하이면 가격 메리트 검토 대상 */
export const PRICE_MERIT_RATIO_THRESHOLD = 70;

const HOUSING_TYPE_PROPERTY_TYPES = new Set(["아파트", "빌라", "오피스텔(주거)"]);

export function isHousingType(propertyType: string): boolean {
  return HOUSING_TYPE_PROPERTY_TYPES.has(propertyType);
}
