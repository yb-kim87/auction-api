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
};

/** 크롤러가 네이버 호가·실거래를 수집하는 대상인지 (item_crawl.py와 동일) */
export function isNaverCollectTarget(record: LinkExistingRecord): boolean {
  if (record.usage.trim() !== "아파트") return false;
  const area = record.area.trim();
  return Boolean(area) && area !== "0" && area !== "없음";
}

/** 네이버 호가·실거래가 아직 비어 있는지 */
export function isNaverDataMissing(record: LinkExistingRecord): boolean {
  if (!isNaverCollectTarget(record)) return false;
  return (
    record.naverPrice === 0 ||
    !record.priceDetail.trim() ||
    !record.tradingDetail.trim()
  );
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
