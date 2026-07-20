import { isClosedCaseState } from "../auctions/crawl-item-validation.util";
import type { CrawlerUrlEntry } from "./crawler.types";

/** 입찰기일 문자열을 날짜(자정)로 파싱 */
export function parseBidDateToDay(bidDate: string): Date | null {
  const trimmed = bidDate.trim();
  if (!trimmed) return null;

  const korean = trimmed.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/);
  if (korean) {
    return new Date(
      parseInt(korean[1], 10),
      parseInt(korean[2], 10) - 1,
      parseInt(korean[3], 10),
    );
  }

  const iso = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return new Date(
      parseInt(iso[1], 10),
      parseInt(iso[2], 10) - 1,
      parseInt(iso[3], 10),
    );
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    const date = new Date(parsed);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  return null;
}

/** 입찰기일이 오늘 또는 과거인지 (중복 갱신 대상) */
export function isBidDateTodayOrPast(bidDate: string): boolean {
  const bidDay = parseBidDateToDay(bidDate);
  if (!bidDay) return true;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return bidDay.getTime() <= today.getTime();
}

/** 입찰기일이 오늘이면서 아직 탱크옥션에 낙찰 결과가 반영되지 않는
 * 시각(오후 5시 이전)인지. 이 경우 재수집해도 어차피 옛 정보 그대로라
 * 목록에서 제외한다(당일 5시 이후에는 결과가 반영되므로 제외하지 않음). */
export function isTodayBidDateBeforeResultTime(
  bidDate: string,
  now: Date = new Date(),
): boolean {
  const bidDay = parseBidDateToDay(bidDate);
  if (!bidDay) return false;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (bidDay.getTime() !== today.getTime()) return false;
  return now.getHours() < 17;
}

/** @deprecated isBidDateTodayOrPast 사용 */
export function isBidDateTodayOrLater(bidDate: string): boolean {
  const bidDay = parseBidDateToDay(bidDate);
  if (!bidDay) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return bidDay.getTime() >= today.getTime();
}

/** @deprecated isBidDateTodayOrPast 사용 */
export function isBidDatePast(bidDate: string): boolean {
  return isBidDateTodayOrPast(bidDate);
}

export function linkDedupeKey(link: string): string {
  return link.trim().split("&")[0];
}

export type LinkExistingRecord = {
  bidDate: string;
  usage: string;
  area: string;
  naverPrice: number;
  priceDetail: string;
  tradingDetail: string;
  caseState: string;
};

/** 크롤러가 네이버 호가·실거래를 수집하는 대상인지 (item_crawl.py와 동일) */
export function isNaverCollectTarget(record: LinkExistingRecord): boolean {
  if (record.usage.trim() !== "아파트") return false;
  const area = record.area.trim();
  return Boolean(area) && area !== "0" && area !== "없음";
}

/** 네이버에서 이 물건과 매칭되는 평형/단지를 찾을 수 없다고 이미 확정된
 * 경우(naver_httpx.py가 남기는 문구). 이런 물건은 재조회해도 네이버 쪽
 * 데이터 자체가 존재하지 않아 매번 똑같이 실패하므로, "아직 못 채움"과
 * 구분해 재시도 대상에서 제외해야 한다(실측: 2025타경1260이 매번 재조회
 * 대상에 걸리던 원인, 2026-07-20). "호가·실거래 없음"은 호가와 실거래를
 * 모두 조회해봤지만 둘 다 없는 경우(2026-07-20 naver_httpx.py 수정 이후
 * 문구)만 포함한다 — "호가 매물 없음"만 확정됐던 이전 문구는 실거래가
 * 아예 조회되지 않은 채였을 수 있어 제외 대상에 넣지 않는다. */
// "네이버 접속 실패"/"호가 조회 실패"는 일시적 네트워크 문제일 수 있어
// 여기 포함하지 않는다 — 확정 취급하면 진짜 일시 오류도 영영 재시도되지
// 않는다. "단지ID 없음"/"면적 파싱 실패"/"평형 없음"은 탱크옥션·네이버
// 원본 데이터 자체의 구조적 문제라 재시도해도 결과가 바뀌지 않는다.
function isNaverDataConfirmedUnavailable(record: LinkExistingRecord): boolean {
  const detail = record.priceDetail.trim();
  return (
    detail === "단지ID 없음" ||
    detail === "면적 파싱 실패" ||
    detail === "면적 조건에 맞는 평형 없음" ||
    detail === "면적 조건에 맞는 호가·실거래 없음"
  );
}

/** 네이버 호가·실거래가 아직 비어 있는지.
 *
 * tradingDetail(실거래)은 정상 조회해도 거래 이력이 0건이면 그냥 빈
 * 문자열로 남는다 — "아직 조회 안 함"과 "조회했지만 0건"을 구분하는
 * 별도 사유 문구가 없다(호가는 naver_price_detail에 "면적 조건에 맞는
 * 평형 없음" 같은 확정 문구를 남기는 것과 다름). tradingDetail 하나만
 * 보고 계속 missing 취급하면, 호가는 이미 정상적으로 다 채워진 물건도
 * 실거래 0건이라는 이유만으로 영원히 재조회 대상에 남는다(실측:
 * 2025타경8789가 호가는 가득 찼는데도 계속 재조회 목록에 걸림,
 * 2026-07-20). priceDetail이 정상적으로 채워졌다면(호가 조회 성공) 그
 * 자체로 이 물건에 대한 네이버 조회가 이미 완료됐다는 뜻이므로,
 * tradingDetail이 비어 있어도 더 이상 missing으로 보지 않는다. */
export function isNaverDataMissing(record: LinkExistingRecord): boolean {
  if (!isNaverCollectTarget(record)) return false;
  if (isNaverDataConfirmedUnavailable(record)) return false;
  if (record.naverPrice !== 0 && record.priceDetail.trim()) return false;
  return true;
}

function collectEntryKey(url: string): string {
  return normalizeTankLink(url) || linkDedupeKey(url);
}

function lookupExistingRecord(
  linkExistingMap: Map<string, LinkExistingRecord>,
  entryUrl: string,
): LinkExistingRecord | undefined {
  const normalized = normalizeTankLink(entryUrl);
  const rawKey = linkDedupeKey(entryUrl);
  return (
    (normalized ? linkExistingMap.get(normalized) : undefined) ??
    linkExistingMap.get(rawKey)
  );
}

/** DB 중복 중 입찰기일이 오늘·과거이거나 네이버 미수집인 항목 유지.
 * 단, 입찰기일이 "오늘"이고 아직 탱크옥션에 낙찰 결과가 반영되지 않는
 * 시각(오후 5시 이전)이면, 재수집해도 옛 정보 그대로라 목록에서 제외한다. */
export function filterCollectedUrls(
  urls: CrawlerUrlEntry[],
  linkExistingMap: Map<string, LinkExistingRecord>,
  now: Date = new Date(),
): {
  urls: CrawlerUrlEntry[];
  excluded: number;
  deduped: number;
  naverRefresh: number;
  beforeResultTime: number;
} {
  const seen = new Set<string>();
  const filtered: CrawlerUrlEntry[] = [];
  let excluded = 0;
  let deduped = 0;
  let naverRefresh = 0;
  let beforeResultTime = 0;

  for (const entry of urls) {
    const key = collectEntryKey(entry.url);
    if (seen.has(key)) {
      deduped += 1;
      continue;
    }
    seen.add(key);

    const existing = lookupExistingRecord(linkExistingMap, entry.url);

    if (existing === undefined) {
      filtered.push(entry);
      continue;
    }

    // 취하·매각(허가) 등 종결된 사건은 더 이상 입찰기일이 갱신되지 않으니
    // 재조회해도 항상 "변경 없음"만 반복된다(실측: 2025타경1260이 이미
    // 처리됐는데도 검색 결과에 계속 남아 재조회되던 문제, 2026-07-20).
    if (isClosedCaseState(existing.caseState)) {
      excluded += 1;
      continue;
    }

    if (isTodayBidDateBeforeResultTime(existing.bidDate, now)) {
      beforeResultTime += 1;
      continue;
    }

    const bidDateEligible = isBidDateTodayOrPast(existing.bidDate);
    const naverMissing = isNaverDataMissing(existing);

    if (bidDateEligible || naverMissing) {
      if (!bidDateEligible && naverMissing) {
        naverRefresh += 1;
      }
      filtered.push(entry);
    } else {
      excluded += 1;
    }
  }

  return { urls: filtered, excluded, deduped, naverRefresh, beforeResultTime };
}

export function normalizeTankLink(link: string): string {
  const trimmed = link.trim();
  const idx = trimmed.indexOf("_");
  const raw = idx === -1 ? trimmed : trimmed.slice(idx + 1);
  return raw.split("&")[0];
}

export function extractCrawlUrl(entry: string): string {
  const idx = entry.indexOf("_");
  if (idx === -1) return entry;
  return entry.slice(idx + 1);
}
