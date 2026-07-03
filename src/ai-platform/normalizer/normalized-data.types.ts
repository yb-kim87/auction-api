export interface NormalizedAuctionData {
  propertyType: string;
  city: string;
  district: string;
  minPriceWon: number;
  appraisedValueWon: number;
  areaRaw: string;
  areaPyeong: number | null;
  /** round(minPrice / appraisedValue * 100). 감정가 대비 최저가 비율(%) — 낮을수록 저감폭이 큼 */
  minPriceToAppraisedRatio: number | null;
  [key: string]: unknown;
}
