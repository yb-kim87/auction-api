import { Auction } from "./auction.entity";
import type { UpdateAuctionDto } from "./update-auction.dto";
import { parseAddressMeta, cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail, cleanElevatorAndParking } from "./address-parser";
import { AuctionStatus } from "../common/constants";
import type { AuctionRow } from "./excel-columns";
import { normalizeAuctionNo } from "./auction-no.util";

interface CreateMeta {
  status: AuctionStatus;
  submittedBy: string;
}

type DiffSource = {
  naverPrice?: number;
  minPrice?: number;
  appraisedValue?: number;
  salePrice?: number | null;
  diffNaverSale?: number | null;
  diffNaverMin?: number | null;
  diffNaverAppraised?: number | null;
};

export function resolvePriceDiffs(parsed: DiffSource) {
  const naver = parsed.naverPrice ?? 0;
  const min = parsed.minPrice ?? 0;
  const appraised = parsed.appraisedValue ?? 0;
  const sale = parsed.salePrice;

  const diffNaverSale =
    parsed.diffNaverSale != null
      ? parsed.diffNaverSale
      : sale != null
        ? naver - sale
        : null;

  const diffNaverMin =
    parsed.diffNaverMin != null ? parsed.diffNaverMin : naver - min;

  const diffNaverAppraised =
    parsed.diffNaverAppraised != null
      ? parsed.diffNaverAppraised
      : naver - appraised;

  return { diffNaverSale, diffNaverMin, diffNaverAppraised };
}

type FieldSource = Partial<AuctionRow> | Partial<UpdateAuctionDto>;

function pickString(
  value: string | null | undefined,
  fallback: string,
): string {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function pickNumber(
  value: number | null | undefined,
  fallback: number,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return value;
}

/** 빈 값이 들어오면 기존 메모 유지, 내용이 다를 때만 갱신 */
function mergeMemo(
  existing: string,
  incoming: string | null | undefined,
): string {
  if (incoming === undefined || incoming === null) return existing;
  const next = String(incoming).trim();
  if (!next) return existing;
  if (next === existing.trim()) return existing;
  return next;
}

type MergeOptions = {
  preserveMemoIfEmpty?: boolean;
};

/** 갱신 시 빈 엑셀 셀(null)이 기존 NOT NULL 필드를 지우지 않도록 병합 */
export function mergeAuctionFromSource(
  existing: Auction,
  source: FieldSource,
  options?: MergeOptions,
): UpdateAuctionDto {
  const memo = options?.preserveMemoIfEmpty
    ? mergeMemo(existing.memo, source.memo)
    : pickString(source.memo, existing.memo);

  return {
    memo,
    link: pickString(source.link, existing.link),
    views: pickNumber(source.views, existing.views),
    auctionNo:
      pickString(source.auctionNo, existing.auctionNo) || existing.auctionNo,
    address: cleanAddress(
      pickString(source.address, existing.address) || existing.address,
    ),
    totalUnits: pickNumber(source.totalUnits, existing.totalUnits),
    usage: pickString(source.usage, existing.usage),
    area: pickString(source.area, existing.area),
    builtYear:
      source.builtYear != null && Number.isFinite(source.builtYear)
        ? source.builtYear
        : existing.builtYear,
    bidDate: pickString(source.bidDate, existing.bidDate),
    appraisedValue: pickNumber(source.appraisedValue, existing.appraisedValue),
    minPrice: pickNumber(source.minPrice, existing.minPrice),
    salePrice:
      source.salePrice !== undefined ? source.salePrice : existing.salePrice,
    naverPrice: pickNumber(source.naverPrice, existing.naverPrice),
    naverId: (() => {
      if (source.naverId === undefined || source.naverId === null) {
        return existing.naverId;
      }
      const next = String(source.naverId).trim();
      return next || existing.naverId;
    })(),
    diffNaverSale:
      source.diffNaverSale !== undefined
        ? source.diffNaverSale
        : existing.diffNaverSale,
    diffNaverMin:
      source.diffNaverMin !== undefined
        ? source.diffNaverMin
        : existing.diffNaverMin,
    diffNaverAppraised:
      source.diffNaverAppraised !== undefined
        ? source.diffNaverAppraised
        : existing.diffNaverAppraised,
    elevator: cleanElevatorAndParking(
      pickString(source.elevator, existing.elevator),
      pickString(source.parking, existing.parking),
    ).elevator,
    parking: cleanElevatorAndParking(
      pickString(source.elevator, existing.elevator),
      pickString(source.parking, existing.parking),
    ).parking,
    landShare: pickString(source.landShare, existing.landShare),
    buildingRegistry: cleanBuildingRegistry(
      pickString(source.buildingRegistry, existing.buildingRegistry),
    ),
    education: cleanEducation(pickString(source.education, existing.education)),
    tradingCount: pickString(source.tradingCount, existing.tradingCount),
    bidInfo: pickString(source.bidInfo, existing.bidInfo),
    owner: pickString(source.owner, existing.owner),
    appraiser: pickString(source.appraiser, existing.appraiser),
    officialLandPrice: pickNumber(
      source.officialLandPrice,
      existing.officialLandPrice,
    ),
    tenantInfo: pickString(source.tenantInfo, existing.tenantInfo),
    specialNote: pickString(source.specialNote, existing.specialNote),
    tenantDetail: cleanTenantDetail(pickString(source.tenantDetail, existing.tenantDetail)),
    priceDetail: pickString(source.priceDetail, existing.priceDetail),
    tradingDetail: pickString(source.tradingDetail, existing.tradingDetail),
    recordTime: pickString(source.recordTime, existing.recordTime),
  };
}

export function buildAuctionEntity(
  parsed: Partial<AuctionRow> | UpdateAuctionDto,
  meta: CreateMeta,
): Auction {
  const auction = new Auction();
  const { city, district, propType } = parseAddressMeta(parsed.address ?? "");
  const diffs = resolvePriceDiffs(parsed);
  const { elevator, parking } = cleanElevatorAndParking(
    parsed.elevator ?? "",
    parsed.parking ?? "",
  );

  Object.assign(auction, {
    memo: parsed.memo ?? "",
    link: parsed.link ?? "",
    views: parsed.views ?? 0,
    auctionNo: parsed.auctionNo ?? "",
    auctionNoNorm: normalizeAuctionNo(parsed.auctionNo ?? ""),
    address: cleanAddress(parsed.address ?? ""),
    totalUnits: parsed.totalUnits ?? 0,
    usage: parsed.usage ?? "",
    area: parsed.area ?? "",
    builtYear: parsed.builtYear ?? 0,
    bidDate: parsed.bidDate ?? "",
    appraisedValue: parsed.appraisedValue ?? 0,
    minPrice: parsed.minPrice ?? 0,
    salePrice: parsed.salePrice ?? null,
    naverPrice: parsed.naverPrice ?? 0,
    naverId: parsed.naverId ?? "",
    ...diffs,
    elevator,
    parking,
    landShare: parsed.landShare ?? "",
    buildingRegistry: cleanBuildingRegistry(parsed.buildingRegistry ?? ""),
    education: cleanEducation(parsed.education ?? ""),
    tradingCount: parsed.tradingCount ?? "",
    bidInfo: parsed.bidInfo ?? "",
    owner: parsed.owner ?? "",
    appraiser: parsed.appraiser ?? "",
    officialLandPrice: parsed.officialLandPrice ?? 0,
    tenantInfo: parsed.tenantInfo ?? "",
    specialNote: parsed.specialNote ?? "",
    tenantDetail: cleanTenantDetail(parsed.tenantDetail ?? ""),
    priceDetail: parsed.priceDetail ?? "",
    tradingDetail: parsed.tradingDetail ?? "",
    recordTime: parsed.recordTime ?? "",
    city,
    district,
    propType,
    status: meta.status,
    submittedBy: meta.submittedBy,
    isUpdated: false,
    updatedAt: null,
    updatedBy: "",
  });

  return auction;
}
