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

export interface ArticleFloorInfo {
  /** 1·2층으로 판단되는지 (숫자 1·2층 또는 "저") */
  isLowFloor: boolean;
  /** 화면 표시용 라벨. 숫자를 알 수 없는 저/중/고는 "저층"/"중층"/"고층"으로 표시 */
  label: string;
  /** 정확한 층수를 알 때만 값이 있음(저/중/고는 null) */
  floorNumber: number | null;
}

function toFloorInfo(token: string): ArticleFloorInfo | null {
  if (token === "저") return { isLowFloor: true, label: "저층", floorNumber: null };
  if (token === "중") return { isLowFloor: false, label: "중층", floorNumber: null };
  if (token === "고") return { isLowFloor: false, label: "고층", floorNumber: null };
  const floor = Number(token);
  if (!Number.isFinite(floor) || floor <= 0) return null;
  return { isLowFloor: floor <= 2, label: `${floor}층`, floorNumber: floor };
}

/**
 * "매매" 뒤에 오는 금액 표기를 원 단위로 되돌린다. 두 크롤러 버전의 표기를 모두 지원한다.
 *  - "6억2,500"(억+뒤이은 만원 단위 숫자, "만" 접미사 없음), "11억"(억만), "4,800만"(만원만)
 *  - "8억 9,000"(억과 뒤 숫자 사이 공백이 있는 예전 포맷)
 * 그룹1/2가 있으면 억(+선택적 뒤 숫자), 그룹3만 있으면 만원 단독.
 */
const PRICE_TOKEN_RE = /매매\s*(?:(\d+)\s*억\s*([\d,]+)?(?:\s*만)?|([\d,]+)\s*만)/g;
const FLOOR_TOKEN_RE = /(\d+|저|중|고)\s*\/\s*(\d+)\s*층?/g;

interface IndexedMatch<T> {
  index: number;
  value: T;
}

function findAllPrices(text: string): IndexedMatch<number>[] {
  const results: IndexedMatch<number>[] = [];
  PRICE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PRICE_TOKEN_RE.exec(text))) {
    let amount: number | null = null;
    if (m[1] != null) {
      const eok = Number(m[1]) * 100_000_000;
      const rest = m[2] ? Number(m[2].replace(/,/g, "")) * 10_000 : 0;
      amount = eok + rest;
    } else if (m[3] != null) {
      amount = Number(m[3].replace(/,/g, "")) * 10_000;
    }
    if (amount != null && amount > 0) {
      results.push({ index: m.index, value: amount });
    }
  }
  return results;
}

function findAllFloors(text: string): IndexedMatch<ArticleFloorInfo>[] {
  const results: IndexedMatch<ArticleFloorInfo>[] = [];
  FLOOR_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FLOOR_TOKEN_RE.exec(text))) {
    const info = toFloorInfo(m[1]);
    if (info) results.push({ index: m.index, value: info });
  }
  return results;
}

interface Candidate {
  price: number;
  isLowFloor: boolean;
  label: string;
  floorNumber: number | null;
}

/**
 * priceDetail 전체 텍스트에서 "매매 가격" 토큰과 그 직후(다음 가격 토큰 전까지)에 나오는
 * 층 토큰을 짝지어 매물 후보를 만든다. 크롤러 버전에 따라 저장 포맷이 다를 수 있어
 * (예: "4/15" vs "23/30층남동향", "매매9억3,000" vs "매매 8억") 블록 단위 분리 대신
 * 텍스트 전체에서 위치 기반으로 짝짓는 방식을 쓴다.
 */
function extractCandidates(priceDetail: string): Candidate[] {
  const text = priceDetail ?? "";
  if (!text.trim()) return [];

  const prices = findAllPrices(text);
  const floors = findAllFloors(text);
  if (prices.length === 0 || floors.length === 0) return [];

  const candidates: Candidate[] = [];
  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const nextPriceIndex = i + 1 < prices.length ? prices[i + 1].index : Infinity;
    const floor = floors.find((f) => f.index > price.index && f.index < nextPriceIndex);
    if (!floor) continue;
    candidates.push({
      price: price.value,
      isLowFloor: floor.value.isLowFloor,
      label: floor.value.label,
      floorNumber: floor.value.floorNumber,
    });
  }
  return candidates;
}

export interface FloorAwareNaverPriceResult {
  naverPrice: number | null;
  naverPriceFloor: number | null;
  naverPriceFloorLabel: string | null;
  /** 목표 층 구간에 맞는 매물이 없어 전체 최저가로 대체했는지 */
  usedFallback: boolean;
}

/**
 * priceDetail(저장된 네이버 호가 상세 텍스트)과 물건 자신의 층수를 바탕으로
 * "물건이 1·2층이면 1·2층(또는 '저') 매물 중 최저가, 그 외에는 3층 이상('중'/'고' 포함) 매물 중 최저가"를 선택한다.
 * 해당 층 구간 매물이 없으면 기존처럼 전체 매물 중 최저가로 대체한다.
 */
export function selectFloorAwareNaverPrice(
  priceDetail: string,
  targetFloor: number | null,
): FloorAwareNaverPriceResult {
  const candidates = extractCandidates(priceDetail);

  if (candidates.length === 0) {
    return { naverPrice: null, naverPriceFloor: null, naverPriceFloorLabel: null, usedFallback: false };
  }

  const pickLowest = (list: Candidate[]) =>
    list.reduce((min, cur) => (cur.price < min.price ? cur : min));

  if (targetFloor == null) {
    const lowest = pickLowest(candidates);
    return {
      naverPrice: lowest.price,
      naverPriceFloor: lowest.floorNumber,
      naverPriceFloorLabel: lowest.label,
      usedFallback: false,
    };
  }

  const isLowFloorTarget = targetFloor <= 2;
  const bucket = candidates.filter((c) => c.isLowFloor === isLowFloorTarget);
  const pool = bucket.length > 0 ? bucket : candidates;
  const lowest = pickLowest(pool);

  return {
    naverPrice: lowest.price,
    naverPriceFloor: lowest.floorNumber,
    naverPriceFloorLabel: lowest.label,
    usedFallback: bucket.length === 0,
  };
}
