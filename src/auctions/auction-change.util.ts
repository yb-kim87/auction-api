import { Auction } from "./auction.entity";
import type { UpdateAuctionDto } from "./update-auction.dto";
import type { AuctionFieldChange } from "./auction-change.entity";
import { formatTenantStatusText } from "./tenant-status.util";

export type ChangeSource =
  | "excel"
  | "crawler"
  | "manual_create"
  | "admin_edit"
  | "consultant_edit";

export const CHANGE_SOURCE_LABELS: Record<ChangeSource, string> = {
  excel: "엑셀 업로드",
  crawler: "크롤러 수집",
  manual_create: "수동 등록",
  admin_edit: "관리자 수정",
  consultant_edit: "컨설턴트 수정",
};

export const AUCTION_FIELD_LABELS: Record<string, string> = {
  memo: "메모",
  link: "링크",
  views: "조회수",
  auctionNo: "경매번호",
  address: "물건주소",
  city: "시/도",
  district: "군/구",
  propType: "물건종류",
  totalUnits: "총 세대수",
  usage: "용도",
  area: "평형",
  builtYear: "연식",
  bidDate: "입찰기일",
  appraisedValue: "감정가",
  minPrice: "최저가",
  salePrice: "낙찰가",
  naverPrice: "네이버 호가",
  naverPriceFloor: "네이버 호가 층수",
  naverPriceFloorLabel: "네이버 호가 층수 라벨",
  naverId: "네이버 ID",
  diffNaverSale: "호가-낙찰가",
  diffNaverMin: "호가-최저가",
  diffNaverAppraised: "호가-감정가",
  tradingCount: "실거래건수",
  bidInfo: "낙찰정보",
  owner: "소유자",
  appraiser: "감정원",
  officialLandPrice: "공시지가",
  tenantInfo: "임차정보",
  specialNote: "특이사항",
  elevator: "승강기",
  parking: "주차장",
  landShare: "토지지분",
  buildingRegistry: "건물등기",
  education: "교육환경",
  tenantDetail: "임차인 현황",
  priceDetail: "호가 상세",
  tradingDetail: "실거래 상세",
  recordTime: "기록시간",
};

const TRACKED_FIELDS = Object.keys(AUCTION_FIELD_LABELS);

const PRICE_FIELDS = new Set([
  "appraisedValue",
  "minPrice",
  "salePrice",
  "naverPrice",
  "officialLandPrice",
  "diffNaverSale",
  "diffNaverMin",
  "diffNaverAppraised",
]);

const COUNT_FIELDS = new Set(["views", "totalUnits", "builtYear"]);

/** 크롤러 갱신 시 단독 변경은 무시하고, 다른 필드 갱신 시에만 함께 반영 */
export const CRAWLER_VOLATILE_FIELDS = new Set(["views", "recordTime"]);

export type AuctionSnapshot = Record<string, string | number | null>;

export function snapshotAuction(item: Auction | UpdateAuctionDto): AuctionSnapshot {
  const snap: AuctionSnapshot = {};
  for (const field of TRACKED_FIELDS) {
    const value = (item as Record<string, unknown>)[field];
    if (value === undefined) {
      snap[field] = null;
    } else if (typeof value === "number") {
      snap[field] = value;
    } else if (value === null) {
      snap[field] = null;
    } else {
      snap[field] = String(value);
    }
  }
  return snap;
}

function pad2(value: string): string {
  return value.padStart(2, "0");
}

function normalizeCompareValue(
  field: string,
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);

  let text = String(value).replace(/\r\n/g, "\n").trim();

  if (field === "bidDate") {
    const match = text.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
    if (match) {
      return `${match[1]}-${pad2(match[2])}-${pad2(match[3])}`;
    }
  }

  if (field === "recordTime") {
    const isoLike = text.includes("T") ? text : text.replace(" ", "T");
    const parsed = Date.parse(isoLike);
    if (!Number.isNaN(parsed)) {
      return String(Math.floor(parsed / 1000));
    }
  }

  if (PRICE_FIELDS.has(field) || COUNT_FIELDS.has(field)) {
    const digits = text.replace(/[^\d-]/g, "");
    if (digits !== "" && digits !== "-") {
      const num = Number(digits);
      if (Number.isFinite(num)) return String(num);
    }
  }

  return text.replace(/\s+/g, " ");
}

export function applyFieldChanges(
  target: Auction,
  source: Auction,
  changes: AuctionFieldChange[],
): void {
  for (const { field } of changes) {
    const value = (source as unknown as Record<string, unknown>)[field];
    if (value !== undefined) {
      (target as unknown as Record<string, unknown>)[field] = value;
    }
  }
}

function formatDisplayValue(
  field: string,
  value: string | number | null | undefined,
): string {
  if (value === null || value === undefined || value === "") return "-";

  if (typeof value === "number") {
    if (PRICE_FIELDS.has(field)) {
      if (value >= 100000000) return `${(value / 100000000).toFixed(2)}억`;
      if (value >= 10000) return `${(value / 10000).toFixed(0)}만`;
      return value.toLocaleString("ko-KR");
    }
    if (COUNT_FIELDS.has(field)) return value.toLocaleString("ko-KR");
    return String(value);
  }

  if (field === "tenantDetail") {
    const formatted = formatTenantStatusText(String(value));
    return formatted || "-";
  }

  return String(value);
}

export function buildFieldChanges(
  before: AuctionSnapshot,
  after: AuctionSnapshot,
): AuctionFieldChange[] {
  const changes: AuctionFieldChange[] = [];

  for (const field of TRACKED_FIELDS) {
    const oldNorm = normalizeCompareValue(field, before[field]);
    const newNorm = normalizeCompareValue(field, after[field]);
    if (oldNorm === newNorm) continue;

    const oldDisplay = formatDisplayValue(field, before[field]);
    const newDisplay = formatDisplayValue(field, after[field]);
    if (oldDisplay === newDisplay) continue;

    changes.push({
      field,
      label: AUCTION_FIELD_LABELS[field] ?? field,
      oldValue: oldDisplay,
      newValue: newDisplay,
    });
  }

  return changes;
}

export function resolveCrawlerUpdateChanges(
  changes: AuctionFieldChange[],
): AuctionFieldChange[] {
  const substantive = changes.filter(
    (change) => !CRAWLER_VOLATILE_FIELDS.has(change.field),
  );
  if (substantive.length === 0) return [];
  return changes;
}
