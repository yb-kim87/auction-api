import { normalizeCrawlAuctionNo } from "./crawl-item-validation.util";

/** 사건번호(예: "2025타경12336")는 법원마다 독립적으로 채번되어, 서로 다른
 * 법원의 별개 사건이 같은 번호를 쓸 수 있다(실측 확인, 2026-07-19). 그래서
 * 물건 식별 고유 키(auctionNoNorm)에는 법원 정보를 반드시 함께 포함해야
 * 한다 — court가 없으면(법원 정보를 아직 못 가져온 경우) 사건번호만으로
 * 정규화한다(하위호환, 기존 데이터 대응). */
export function normalizeAuctionNo(
  auctionNo: string,
  court?: string | null,
): string | null {
  const fromCrawl = normalizeCrawlAuctionNo(auctionNo);
  const base = fromCrawl ?? auctionNo.replace(/\s/g, "").trim() ?? null;
  if (!base) return null;
  const courtKey = (court ?? "").replace(/\s/g, "").trim();
  return courtKey ? `${courtKey}|${base}` : base;
}
