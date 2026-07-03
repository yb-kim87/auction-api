import type { UpdateAuctionDto } from "./update-auction.dto";

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
