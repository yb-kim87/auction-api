const SQM_PER_PYEONG = 3.305785;

export interface AreaParseResult {
  pyeong: number | null;
  changed: boolean;
}

/**
 * Auction.area는 자유 텍스트("24.5평", "84.98㎡", "84.98" 등)로 저장되어 있어
 * 파싱 가능한 형식일 때만 평 단위 숫자로 변환한다. 파싱 불가능하면 null(추론하지 않음).
 */
export function parseAreaToPyeong(raw: string): AreaParseResult {
  const text = (raw ?? "").trim();
  if (!text) return { pyeong: null, changed: false };

  const numberMatch = text.match(/[\d]+(\.[\d]+)?/);
  if (!numberMatch) return { pyeong: null, changed: false };

  const num = Number(numberMatch[0]);
  if (!Number.isFinite(num) || num <= 0) return { pyeong: null, changed: false };

  const isSqm = /㎡|m2|m²|평방미터/i.test(text);
  const isPyeong = /평/.test(text);

  if (isSqm) {
    return { pyeong: Math.round((num / SQM_PER_PYEONG) * 10) / 10, changed: true };
  }
  if (isPyeong) {
    return { pyeong: num, changed: false };
  }

  // 단위 표기가 없는 순수 숫자는 관행상 ㎡로 취급하지 않고, 평으로 단정하지도 않는다 — 추론 금지.
  return { pyeong: null, changed: false };
}
