import { Auction } from "../auctions/auction.entity";

export type RuleFieldType = "number" | "string" | "boolean";

export interface RuleFieldDef {
  key: string;
  label: string;
  type: RuleFieldType;
  /** Auction 레코드에서 이 필드의 평가용 원시값을 뽑아낸다(파생값 계산 포함) */
  extract: (item: Auction) => number | string | boolean | null;
}

function parseAreaSqm(area: string): number | null {
  const num = Number.parseFloat(String(area ?? "").match(/[\d.]+/)?.[0] ?? "");
  return Number.isFinite(num) ? num : null;
}

/**
 * 관리자가 규칙을 만들 때 선택할 수 있는 필드의 단일 소스(whitelist).
 * 여기 없는 필드는 규칙에 쓸 수 없다 — 새 필드가 필요하면 이 배열에만 추가하면 된다.
 */
export const RULE_FIELDS: RuleFieldDef[] = [
  {
    key: "area_sqm",
    label: "전용면적(㎡)",
    type: "number",
    extract: (item) => parseAreaSqm(item.area),
  },
  {
    key: "min_price_ratio",
    label: "최저가/감정가 비율(%)",
    type: "number",
    extract: (item) =>
      item.appraisedValue > 0 ? (item.minPrice / item.appraisedValue) * 100 : null,
  },
  {
    key: "built_year",
    label: "사용승인년도",
    type: "number",
    extract: (item) => (item.builtYear > 0 ? item.builtYear : null),
  },
  {
    key: "usage",
    label: "물건 용도(예: 아파트, 빌라, 공장)",
    type: "string",
    extract: (item) => item.usage ?? "",
  },
  {
    key: "prop_type",
    label: "물건 대분류",
    type: "string",
    extract: (item) => item.propType ?? "",
  },
  {
    key: "city",
    label: "시/도",
    type: "string",
    extract: (item) => item.city ?? "",
  },
  {
    key: "district",
    label: "구/군",
    type: "string",
    extract: (item) => item.district ?? "",
  },
  {
    key: "address",
    label: "주소 전체",
    type: "string",
    extract: (item) => item.address ?? "",
  },
  {
    key: "special_note",
    label: "특이사항",
    type: "string",
    extract: (item) => item.specialNote ?? "",
  },
];

export const RULE_FIELD_MAP = new Map(RULE_FIELDS.map((f) => [f.key, f]));

export type RuleOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "contains";

export const RULE_OPERATORS: Array<{ key: RuleOperator; label: string; types: RuleFieldType[] }> = [
  { key: "gt", label: "초과 (>)", types: ["number"] },
  { key: "gte", label: "이상 (>=)", types: ["number"] },
  { key: "lt", label: "미만 (<)", types: ["number"] },
  { key: "lte", label: "이하 (<=)", types: ["number"] },
  { key: "eq", label: "같음 (=)", types: ["number", "string", "boolean"] },
  { key: "neq", label: "다름 (!=)", types: ["number", "string", "boolean"] },
  { key: "contains", label: "포함", types: ["string"] },
];
