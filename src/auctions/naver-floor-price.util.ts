/**
 * 물건 자신의 주소 끝 "OOO호"에서 층수를 추정한다.
 * 관행: 마지막 2자리는 층 내 호 번호, 그 앞자리가 층수 (203호→2층, 3505호→35층).
 * 호수 표기가 없으면 null(추론하지 않음).
 */
export function parseUnitFloorFromAddress(address: string): number | null {
  const match = (address ?? "").match(/(\d{3,5})\s*호(?!\S)/);
  if (!match) return null;
  const unitNo = Number(match[1]);
  if (!Number.isFinite(unitNo) || unitNo <= 0) return null;
  const floor = Math.floor(unitNo / 100);
  return floor > 0 ? floor : null;
}

/**
 * priceDetail 한 줄(예: "201동 매매9억3,000~9억4,000 164㎡ (전용134) 4/15 2026.06.27 8곳 등록")에서
 * 현재층 숫자만 추출. "저/15", "중/15", "고/15"처럼 비숫자 층은 정확한 층을 알 수 없어 null 처리.
 */
export function parseNaverArticleFloor(line: string): number | null {
  const match = line.match(/(?:^|\s)(\d+|저|중|고)\/(\d+)(?=\s|$)/);
  if (!match) return null;
  const current = match[1];
  if (!/^\d+$/.test(current)) return null;
  const floor = Number(current);
  return Number.isFinite(floor) && floor > 0 ? floor : null;
}

/**
 * 크롤러의 _compact_price_label()이 만든 금액 표기를 원 단위로 되돌린다.
 * "8억4,000"(8억+4,000만, "만" 접미사 없음), "11억"(억만), "4,800만"(만원만) 세 형태를 지원.
 */
function parseCompactAmount(text: string): number | null {
  const eokWithRest = text.match(/^(\d+)억([\d,]+)?$/);
  if (eokWithRest) {
    const eok = Number(eokWithRest[1]) * 100_000_000;
    const rest = eokWithRest[2] ? Number(eokWithRest[2].replace(/,/g, "")) * 10_000 : 0;
    return eok + rest;
  }
  const manOnly = text.match(/^([\d,]+)만$/);
  if (manOnly) {
    return Number(manOnly[1].replace(/,/g, "")) * 10_000;
  }
  return null;
}

/** priceDetail 한 줄에서 "매매" 가격(최저 호가, 원 단위)을 추출. */
export function parseNaverArticleLinePrice(line: string): number | null {
  const match = line.match(/매매([\d억,만~]+)/);
  if (!match) return null;
  const first = match[1].split("~")[0];
  const amount = parseCompactAmount(first);
  return amount != null && amount > 0 ? amount : null;
}

export interface FloorAwareNaverPriceResult {
  naverPrice: number | null;
  naverPriceFloor: number | null;
  /** 목표 층 구간에 맞는 매물이 없어 전체 최저가로 대체했는지 */
  usedFallback: boolean;
}

const LOW_FLOOR_MAX = 2;

/**
 * priceDetail(저장된 네이버 호가 상세 텍스트)과 물건 자신의 층수를 바탕으로
 * "물건이 1·2층이면 1·2층 매물 중 최저가, 그 외에는 3층 이상 매물 중 최저가"를 선택한다.
 * 해당 층 구간 매물이 없으면 기존처럼 전체 매물 중 최저가로 대체한다.
 */
export function selectFloorAwareNaverPrice(
  priceDetail: string,
  targetFloor: number | null,
): FloorAwareNaverPriceResult {
  const lines = (priceDetail ?? "")
    .split(/\n\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates: { price: number; floor: number }[] = [];
  for (const line of lines) {
    const floor = parseNaverArticleFloor(line);
    const price = parseNaverArticleLinePrice(line);
    if (floor != null && price != null) {
      candidates.push({ price, floor });
    }
  }

  if (candidates.length === 0) {
    return { naverPrice: null, naverPriceFloor: null, usedFallback: false };
  }

  const pickLowest = (list: { price: number; floor: number }[]) =>
    list.reduce((min, cur) => (cur.price < min.price ? cur : min));

  if (targetFloor == null) {
    const lowest = pickLowest(candidates);
    return { naverPrice: lowest.price, naverPriceFloor: lowest.floor, usedFallback: false };
  }

  const isLowFloorTarget = targetFloor <= LOW_FLOOR_MAX;
  const bucket = candidates.filter((c) =>
    isLowFloorTarget ? c.floor <= LOW_FLOOR_MAX : c.floor > LOW_FLOOR_MAX,
  );
  const pool = bucket.length > 0 ? bucket : candidates;
  const lowest = pickLowest(pool);

  return {
    naverPrice: lowest.price,
    naverPriceFloor: lowest.floor,
    usedFallback: bucket.length === 0,
  };
}
