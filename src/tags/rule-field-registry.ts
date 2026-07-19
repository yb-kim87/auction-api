import { Auction } from "../auctions/auction.entity";
import { parseUnitFloorFromAddress } from "../auctions/naver-floor-price.util";

export type RuleFieldType = "number" | "string" | "boolean";

const METROPOLITAN_CITIES = new Set(["서울특별시", "인천광역시", "경기도"]);

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
  {
    key: "tenant_detail",
    label: "임차인 현황(원본 텍스트, 예: 전입:미상 확정:미상 배당:없음)",
    type: "string",
    extract: (item) => item.tenantDetail ?? "",
  },
  {
    key: "official_land_price",
    label: "공시가격(원)",
    type: "number",
    extract: (item) => (item.officialLandPrice > 0 ? item.officialLandPrice : null),
  },
  {
    key: "is_metropolitan",
    label: "수도권 여부(서울·경기·인천, 아니면 지방)",
    type: "boolean",
    extract: (item) => METROPOLITAN_CITIES.has(item.city ?? ""),
  },
  {
    key: "unit_floor",
    label: "층수(주소 호수 기반 추정)",
    type: "number",
    extract: (item) => parseUnitFloorFromAddress(item.address ?? ""),
  },
  {
    key: "is_redevelopment",
    label: "재개발 여부(관리자 직접 표시)",
    type: "boolean",
    extract: (item) => Boolean(item.isRedevelopment),
  },
];

export const RULE_FIELD_MAP = new Map(RULE_FIELDS.map((f) => [f.key, f]));

export type RuleOperator =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "neq"
  | "contains"
  | "in"
  | "contains_any";

export const RULE_OPERATORS: Array<{ key: RuleOperator; label: string; types: RuleFieldType[] }> = [
  { key: "gt", label: "초과 (>)", types: ["number"] },
  { key: "gte", label: "이상 (>=)", types: ["number"] },
  { key: "lt", label: "미만 (<)", types: ["number"] },
  { key: "lte", label: "이하 (<=)", types: ["number"] },
  { key: "eq", label: "같음 (=)", types: ["number", "string", "boolean"] },
  { key: "neq", label: "다름 (!=)", types: ["number", "string", "boolean"] },
  { key: "contains", label: "포함", types: ["string"] },
  { key: "in", label: "다음 중 하나와 일치", types: ["string"] },
  { key: "contains_any", label: "다음 중 하나 이상 포함", types: ["string"] },
];

/** 관리자 화면에서 값 입력을 텍스트 대신 실제 존재하는 값 목록의 드롭박스(다중선택)로
 *  보여줄 필드. usage처럼 DB에 실제로 어떤 값이 있는지 미리 알 수 없는 자유 텍스트
 *  필드에서, "빌라" 조건을 만들 때 다세대주택·연립주택·도시형생활주택 등을 한 번에
 *  고를 수 있게 하기 위함(2026-07-19). */
export const RULE_VALUE_OPTIONS_FIELDS = new Set(["usage", "special_note"]);

/** 크롤러 화면의 "특수조건" 체크박스 라벨과 동일한 목록(2026-07-19). 특이사항
 * (special_note) 필드는 DB에 자유 문장이 그대로 들어있어 distinct 조회로는
 * 드롭박스 후보를 만들 수 없어, 이미 관리자가 익숙한 이 고정 키워드 목록을
 * 그대로 재사용한다. 크롤러 쪽 SPECIAL_CONDITION_GROUPS(presets_httpx.py)와
 * 반드시 같은 라벨을 유지해야 한다. */
export const SPECIAL_NOTE_KEYWORD_OPTIONS: string[] = [
  "유치권",
  "유치권 배제",
  "법정지상권",
  "분묘기지권",
  "선순위 가등기",
  "선순위 가처분",
  "지분입찰 물건",
  "임차인우선매수신고",
  "선순위 전세권 설정",
  "선순위 임차권 설정",
  "임차권 등기",
  "대항력 있는 임차인",
  "전세권만 매각",
  "HUG 임차권 인수조건변경",
  "HF 임차권 인수조건변경",
  "맹지",
  "위반건축물",
  "오늘 공고된 신건",
  "재매각 물건",
  "반값 경매물건",
  "토지건물 일괄매각",
  "대지권미등기",
  "토지별도등기 있는 물건",
  "토지별도등기인수조건",
  "건물만 입찰 물건",
  "토지만 입찰 물건",
  "감정시점 1년 지난 물건",
  "경매/공매 동시 (진행/과거)",
  "최근 2주 주요변동 물건",
  "NPL 물건",
  "공고보다 빠른 신건",
  "공고임박 예정물건(주소만 검색)",
  "공유자우선매수",
  "농지취득자격증명",
  "채권자매수청구",
  "대위변제",
  "항고사건",
  "임금채권자",
  "유치권에 의한 형식적경매",
  "공유물분할을 위한 형식적경매",
  "청산을 위한 형식적경매",
  "기타 형식적경매",
];
