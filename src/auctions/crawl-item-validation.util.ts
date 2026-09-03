import type { UpdateAuctionDto } from "./update-auction.dto";

/** 탱크옥션 baseInfo.stateNm 원문 기준(실측, 2026-07-20) — "변경"은 다음
 * 매각기일이 다시 잡힐 수 있어 제외 대상이 아니다. 매각결정기일·지급기한·
 * 배당기일은 이미 낙찰이 확정된 뒤의 후속 절차 단계라 입찰기일이 다시
 * 잡히지 않으므로 함께 종결 처리한다(실측: 이 값들이 CLOSED_CASE_STATES에
 * 없어 당일물건 조회가 매번 "변경 없음"만 반복하며 재조회하던 문제,
 * 2026-07-20 — DB 전수조사로 실제 caseState 분포 확인). auctions.service.ts와
 * crawler-url.util.ts 양쪽에서 같은 기준으로 종결 여부를 판단하기 위해
 * 공용으로 둔다. */
export const CLOSED_CASE_STATES = new Set([
  "취하",
  "매각",
  "허가",
  "기각",
  "각하",
  "취소",
  "매각결정기일",
  "지급기한",
  "배당기일",
  "배당종결",
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

/** 크롤 소스별 물건 링크 형식 검증. 원래 탱크옥션 전용이었는데, 나이스옥션
 * 작업창(2026-08-07)도 같은 저장 파이프라인(mapCrawledItem/
 * importCrawledItem)을 그대로 재사용하면서 여기서 막혔다 — 탱크 링크
 * 판정 로직은 그대로 두고 나이스 링크 패턴만 추가했다. 대법원 작업창
 * (2026-09-03)도 동일한 이유로 courtauction.go.kr 패턴을 추가한다 — 대법원은
 * 로그인 없이 바로 열리는 물건별 고정 링크가 없어(2026-07-30 조사) 내부
 * 식별자 겸 앵커(`#courtauction-<docid>`)를 링크로 쓰는데, 이 화이트리스트에
 * 없어서 24건 전부 invalid_link로 스킵되는 회귀가 있었다(사용자 신고). */
export function isValidTankAuctionLink(link: string): boolean {
  const trimmed = link.trim();
  if (!trimmed) return true;
  if (trimmed.includes("tankauction.com")) {
    return /\/(ca|pa)\/(caView|paView)\.php/.test(trimmed);
  }
  if (trimmed.includes("niceauction.co.kr")) {
    return /\/auction\/detail\/\d+/.test(trimmed);
  }
  if (trimmed.includes("courtauction.go.kr")) {
    return /#courtauction-/.test(trimmed);
  }
  return false;
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
