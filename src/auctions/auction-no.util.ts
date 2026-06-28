/** 경매번호 비교용 정규화 (공백 제거) */
export function normalizeAuctionNo(auctionNo: string): string | null {
  const normalized = auctionNo.replace(/\s/g, "").trim();
  return normalized || null;
}
