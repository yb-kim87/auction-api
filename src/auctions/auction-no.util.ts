import { normalizeCrawlAuctionNo } from "./crawl-item-validation.util";

/** 경매번호 비교용 정규화 — 동일 사건(2025타경33665)의 물건 suffix (1) 등은 하나로 취급 */
export function normalizeAuctionNo(auctionNo: string): string | null {
  const fromCrawl = normalizeCrawlAuctionNo(auctionNo);
  if (fromCrawl) return fromCrawl;
  const normalized = auctionNo.replace(/\s/g, "").trim();
  return normalized || null;
}
