/**
 * 크롤/엑셀 원본 물건종류 표기를 표준값으로 매핑한다.
 * 표준값 목록은 프런트 PROPERTY_TYPE_OPTIONS(young/auction/src/data/property-type-options.ts)와 맞춘다.
 * 매핑되지 않는 값은 원본을 trim만 해서 그대로 사용한다(추론하지 않음).
 */
const PROPERTY_TYPE_ALIASES: Record<string, string> = {
  "아파트": "아파트",
  "공동주택(아파트)": "아파트",
  "공동주택": "아파트",
  "APT": "아파트",
  "아파트(주상복합)": "아파트",

  "빌라": "빌라",
  "다세대주택": "빌라",
  "도시형생활주택": "빌라",
  "연립주택": "빌라",

  "오피스텔": "오피스텔(주거)",
  "오피스텔(주거)": "오피스텔(주거)",
  "오피스텔(상업)": "오피스텔(상업)",

  "단독주택": "단독주택",
  "다가구주택": "다가구주택",
  "다가구": "다가구주택",
  "기숙사": "기숙사",
  "상가주택": "상가주택",
  "상업 및 산업용": "상업 및 산업용",
  "근린생활시설": "근린생활시설",
  "근린상가": "근린상가",
};

const ALIAS_LOOKUP = new Map(
  Object.entries(PROPERTY_TYPE_ALIASES).map(([k, v]) => [k.trim().toUpperCase(), v]),
);

export interface PropertyTypeNormalizeResult {
  value: string;
  changed: boolean;
}

export function normalizePropertyType(raw: string): PropertyTypeNormalizeResult {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: "", changed: false };

  const mapped = ALIAS_LOOKUP.get(trimmed.toUpperCase());
  if (mapped == null) return { value: trimmed, changed: false };

  return { value: mapped, changed: mapped !== trimmed };
}
