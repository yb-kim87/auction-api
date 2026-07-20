import type { UpdateAuctionDto } from "./update-auction.dto";

/** 탱크옥션 baseInfo.stateNm 원문 기준(실측, 2026-07-20) — "변경"은 다음
 * 매각기일이 다시 잡힐 수 있어 제외 대상이 아니다. auctions.service.ts와
 * crawler-url.util.ts 양쪽에서 같은 기준으로 종결 여부를 판단하기 위해
 * 공용으로 둔다. */
export const CLOSED_CASE_STATES = new Set([
  "취하",
  "매각",
  "허가",
  "기각",
  "각하",
  "취소",
]);

export function isClosedCaseState(caseState: string | undefined): boolean {
  return CLOSED_CASE_STATES.has((caseState ?? "").trim());
}

const AUCTION_NO_PATTERN = /^\d{4}타경\d+(?:\(\d+\))?$/;

const INVALID_AUCTION_NO_HINTS = [
  /MY위젯/i,
  /도움말/,
  /위젯/,
  /로그아웃/,
  /로그인/,
  /님\s*MY/i,
];

export function normalizeCrawlAuctionNo(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const compact = trimmed.replace(/\s/g, "");
  const taMatch = compact.match(/^(\d{4})타경(\d+)(?:\((\d+)\))?$/);
  if (taMatch) {
    const [, year, serial, pn] = taMatch;
    return pn ? `${year}타경${serial}(${pn})` : `${year}타경${serial}`;
  }
  const embedded = compact.match(/(\d{4})타경(\d+)(?:\((\d+)\))?/);
  if (embedded) {
    const [, year, serial, pn] = embedded;
    return pn ? `${year}타경${serial}(${pn})` : `${year}타경${serial}`;
  }

  const dashMatch = trimmed.match(/(\d{4})\s*-\s*(\d+)/);
  if (dashMatch) return `${dashMatch[1]}타경${dashMatch[2]}`;

  if (AUCTION_NO_PATTERN.test(compact)) return compact;
  return null;
}

export function isValidTankAuctionLink(link: string): boolean {
  const trimmed = link.trim();
  if (!trimmed) return true;
  if (!trimmed.includes("tankauction.com")) return false;
  return /\/(ca|pa)\/(caView|paView)\.php/.test(trimmed);
}

export function isMeaningfulCrawlAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  if (trimmed === "없음" || trimmed === "값없음") return false;
  return true;
}

export type CrawlItemValidation =
  | { valid: true; auctionNo: string }
  | { valid: false; reason: "invalid_auction_no" | "invalid_address" | "invalid_link" };

export function validateCrawledItem(
  dto: Partial<UpdateAuctionDto>,
): CrawlItemValidation {
  const rawAuctionNo = String(dto.auctionNo ?? "").trim();
  for (const hint of INVALID_AUCTION_NO_HINTS) {
    if (hint.test(rawAuctionNo)) {
      return { valid: false, reason: "invalid_auction_no" };
    }
  }

  const auctionNo = normalizeCrawlAuctionNo(rawAuctionNo);
  if (!auctionNo) {
    return { valid: false, reason: "invalid_auction_no" };
  }

  if (!isMeaningfulCrawlAddress(String(dto.address ?? ""))) {
    return { valid: false, reason: "invalid_address" };
  }

  const link = String(dto.link ?? "").trim();
  if (link && !isValidTankAuctionLink(link)) {
    return { valid: false, reason: "invalid_link" };
  }

  return { valid: true, auctionNo };
}
