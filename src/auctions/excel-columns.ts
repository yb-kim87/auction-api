import { cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail } from "./address-parser";

export const EXCEL_COLUMN_MAP: Record<string, string> = {
  메모: "memo",
  링크: "link",
  조회수: "views",
  경매번호: "auctionNo",
  물건주소: "address",
  "총 세대수": "totalUnits",
  용도: "usage",
  평형: "area",
  연식: "builtYear",
  입찰기일: "bidDate",
  감정가: "appraisedValue",
  최저가: "minPrice",
  낙찰가: "salePrice",
  "네이버 호가": "naverPrice",
  "호가 - 낙찰가": "diffNaverSale",
  "호가 - 최저가": "diffNaverMin",
  "호가 - 감정가": "diffNaverAppraised",
  실거래건수: "tradingCount",
  낙찰정보: "bidInfo",
  소유자: "owner",
  감정원: "appraiser",
  공시지가: "officialLandPrice",
  임차정보: "tenantInfo",
  특이사항: "specialNote",
  승강기: "elevator",
  주차장: "parking",
  토지지분: "landShare",
  건물등기: "buildingRegistry",
  교육환경: "education",
  임차인현황: "tenantDetail",
  "호가 상세": "priceDetail",
  "실거래 상세": "tradingDetail",
  기록시간: "recordTime",
};

export const EXCEL_HEADERS = Object.keys(EXCEL_COLUMN_MAP);

/** 헤더 별칭 (공백 없는 형식 등) */
const HEADER_ALIASES: Record<string, string> = {
  "호가-낙찰가": "호가 - 낙찰가",
  "호가-매각가": "호가 - 낙찰가",
  "호가 - 매각가": "호가 - 낙찰가",
  "호가-최저가": "호가 - 최저가",
  "호가-감정가": "호가 - 감정가",
  매각가: "낙찰가",
  입찰정보: "낙찰정보",
  "입찰 정보": "낙찰정보",
};

const DIFF_FIELDS = new Set([
  "diffNaverSale",
  "diffNaverMin",
  "diffNaverAppraised",
]);

const INT_FIELDS = new Set([
  "views",
  "totalUnits",
  "appraisedValue",
  "minPrice",
  "salePrice",
  "naverPrice",
  "officialLandPrice",
]);

function normalizeRowKeys(row: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const trimmed = key.trim();
    const canonical = HEADER_ALIASES[trimmed] ?? trimmed;
    normalized[canonical] = value;
  }
  return normalized;
}

/** Excel 날짜 시리얼(예: 28856) → 연도 */
function excelSerialToYear(serial: number): number | null {
  const year = new Date((Math.round(serial) - 25569) * 86400 * 1000).getUTCFullYear();
  return year >= 1900 && year <= 2100 ? year : null;
}

/** 연식: 1979, "1979년", 엑셀 날짜 셀 등 다양한 형식 지원 */
export function parseBuiltYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const year = value.getFullYear();
    return year >= 1900 && year <= 2100 ? year : null;
  }

  if (typeof value === "number") {
    const rounded = Math.round(value);
    if (rounded >= 1900 && rounded <= 2100) return rounded;
    if (rounded > 3000) return excelSerialToYear(rounded);
    return null;
  }

  const str = String(value).replace(/,/g, "").trim();
  if (!str || str === "-") return null;

  const yearMatch = str.match(/(?:19|20)\d{2}/);
  if (yearMatch) return parseInt(yearMatch[0], 10);

  const koreanYearMatch = str.match(/(\d{2,4})\s*년/);
  if (koreanYearMatch) {
    let y = parseInt(koreanYearMatch[1], 10);
    if (y < 100) y += y >= 50 ? 1900 : 2000;
    if (y >= 1900 && y <= 2100) return y;
  }

  const num = Number(str);
  if (Number.isFinite(num)) {
    const rounded = Math.round(num);
    if (rounded >= 1900 && rounded <= 2100) return rounded;
    if (rounded > 3000) return excelSerialToYear(rounded);
  }

  const parsedMs = Date.parse(str);
  if (!Number.isNaN(parsedMs)) {
    const y = new Date(parsedMs).getFullYear();
    if (y >= 1900 && y <= 2100) return y;
  }

  return null;
}

function parseNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Math.round(value);
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parsePriceDiff(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Math.round(value);

  const str = String(value).replace(/,/g, "").trim();
  if (!str || str === "-") return null;

  const sign = str.startsWith("-") ? -1 : 1;
  const cleaned = str.replace(/^[+-]/, "").trim();

  const eokMatch = cleaned.match(/^([\d.]+)\s*억/);
  if (eokMatch) {
    return Math.round(sign * parseFloat(eokMatch[1]) * 100000000);
  }

  const manMatch = cleaned.match(/^([\d.]+)\s*만/);
  if (manMatch) {
    return Math.round(sign * parseFloat(manMatch[1]) * 10000);
  }

  const num = Number(cleaned);
  return Number.isFinite(num) ? Math.round(sign * num) : null;
}

function parseString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function rowToAuction(row: Record<string, unknown>): Partial<AuctionRow> {
  const normalized = normalizeRowKeys(row);
  const item: Record<string, unknown> = {};

  for (const [header, field] of Object.entries(EXCEL_COLUMN_MAP)) {
    const raw = normalized[header];
    if (field === "builtYear") {
      item[field] = parseBuiltYear(raw);
    } else if (field === "address") {
      item[field] = cleanAddress(parseString(raw));
    } else if (field === "education") {
      item[field] = cleanEducation(parseString(raw));
    } else if (field === "buildingRegistry") {
      item[field] = cleanBuildingRegistry(parseString(raw));
    } else if (field === "tenantDetail") {
      item[field] = cleanTenantDetail(parseString(raw));
    } else if (DIFF_FIELDS.has(field)) {
      item[field] = parsePriceDiff(raw);
    } else if (INT_FIELDS.has(field)) {
      item[field] = parseNumber(raw);
    } else {
      item[field] = parseString(raw);
    }
  }

  if (item.salePrice === null) {
    item.salePrice = null;
  }

  return item as Partial<AuctionRow>;
}

export interface AuctionRow {
  memo: string;
  link: string;
  views: number;
  auctionNo: string;
  address: string;
  totalUnits: number;
  usage: string;
  area: string;
  builtYear: number;
  bidDate: string;
  appraisedValue: number;
  minPrice: number;
  salePrice: number | null;
  naverPrice: number;
  naverId: string;
  diffNaverSale: number | null;
  diffNaverMin: number;
  diffNaverAppraised: number;
  elevator: string;
  parking: string;
  landShare: string;
  buildingRegistry: string;
  education: string;
  tradingCount: string;
  bidInfo: string;
  owner: string;
  appraiser: string;
  officialLandPrice: number;
  tenantInfo: string;
  specialNote: string;
  tenantDetail: string;
  priceDetail: string;
  tradingDetail: string;
  recordTime: string;
  city: string;
  district: string;
  propType: string;
}

export function isValidAuctionRow(row: Partial<AuctionRow>): boolean {
  return Boolean(row.auctionNo || row.address);
}
