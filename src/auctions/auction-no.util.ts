import { normalizeCrawlAuctionNo } from "./crawl-item-validation.util";

/** 경매번호 비교용 정규화 — 물건 suffix (1)(2) 등은 각각 별도 키로 보존 */
export function normalizeAuctionNo(auctionNo: string): string | null {
  const fromCrawl = normalizeCrawlAuctionNo(auctionNo);
  if (fromCrawl) return fromCrawl;
  const normalized = auctionNo.replace(/\s/g, "").trim();
  return normalized || null;
}
