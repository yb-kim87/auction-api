import { Auction } from "./auction.entity";
import type { UpdateAuctionDto } from "./update-auction.dto";
import { parseAddressMeta, cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail, cleanElevatorAndParking } from "./address-parser";
import { AuctionStatus } from "../common/constants";
import type { AuctionRow } from "./excel-columns";
import { normalizeAuctionNo } from "./auction-no.util";
import { hasNaverPrice } from "./naver-price.util";

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
  if (!hasNaverPrice(naver)) {
    return {
      diffNaverSale: null,
      diffNaverMin: 0,
      diffNaverAppraised: 0,
    };
  }

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
  /** 크롤 갱신 — 수집 실패(빈값·0·없음) 시 기존 DB 값 유지 */
  preserveExistingIfEmpty?: boolean;
  /** 나이스크롤러가 기존 물건(주로 탱크옥션에서 수집)을 갱신할 때 "경매지
   * 정보" 버튼에 쓰이는 link를 나이스옥션 링크로 덮어써버리던 문제
   * 수정(사용자 요청, 2026-08-18: "경매지 정보가 나이스옥션으로
   * 연결되던데 이건 왜그러는거지?? 탱크옥션으로 안되고?"). true면 기존
   * link가 이미 있을 때 새 값으로 덮어쓰지 않고 그대로 유지한다(빈
   * 경우에만 채움). */
  preserveLinkIfExists?: boolean;
};

const CRAWL_EMPTY_TEXT = new Set(["", "없음", "값없음", "임차정보없음"]);

function hasExistingText(value: string): boolean {
  const text = String(value ?? "").trim();
  return !!text && !CRAWL_EMPTY_TEXT.has(text);
}

function pickStringWithOptions(
  value: string | null | undefined,
  fallback: string,
  options?: MergeOptions,
): string {
  if (value === undefined || value === null) return fallback;
  const next = String(value).trim();
  if (!options?.preserveExistingIfEmpty) {
    return next;
  }
  if (!hasExistingText(fallback)) {
    return next || fallback;
  }
  if (!next || CRAWL_EMPTY_TEXT.has(next)) {
    return fallback;
  }
  return next;
}

function pickNumberWithOptions(
  value: number | null | undefined,
  fallback: number,
  options?: MergeOptions,
  zeroIsEmpty = true,
): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (
    options?.preserveExistingIfEmpty &&
    zeroIsEmpty &&
    value === 0 &&
    fallback !== 0
  ) {
    return fallback;
  }
  return value;
}

function pickNullableNumberWithOptions(
  value: number | null | undefined,
  fallback: number | null,
  options?: MergeOptions,
): number | null {
  if (value === undefined) return fallback;
  if (value === null) {
    if (
      options?.preserveExistingIfEmpty &&
      fallback != null &&
      fallback > 0
    ) {
      return fallback;
    }
    return null;
  }
  if (!Number.isFinite(value)) return fallback;
  if (
    options?.preserveExistingIfEmpty &&
    value === 0 &&
    fallback != null &&
    fallback > 0
  ) {
    return fallback;
  }
  return value;
}

/** 갱신 시 빈 엑셀 셀(null)이 기존 NOT NULL 필드를 지우지 않도록 병합 */
export function mergeAuctionFromSource(
  existing: Auction,
  source: FieldSource,
  options?: MergeOptions,
): UpdateAuctionDto {
  const pickStr = (value: string | null | undefined, fallback: string) =>
    pickStringWithOptions(value, fallback, options);
  const pickNum = (
    value: number | null | undefined,
    fallback: number,
    zeroIsEmpty = true,
  ) => pickNumberWithOptions(value, fallback, options, zeroIsEmpty);
  const pickNullableNum = (value: number | null | undefined, fallback: number | null) =>
    pickNullableNumberWithOptions(value, fallback, options);

  const memo = options?.preserveMemoIfEmpty
    ? mergeMemo(existing.memo, source.memo)
    : pickStr(source.memo, existing.memo);

  const link =
    options?.preserveLinkIfExists && hasExistingText(existing.link)
      ? existing.link
      : pickStr(source.link, existing.link);

  const merged: UpdateAuctionDto = {
    memo,
    link,
    views: pickNum(source.views, existing.views, false),
    auctionNo: pickStr(source.auctionNo, existing.auctionNo) || existing.auctionNo,
    court: pickStr(
      "court" in source ? source.court : undefined,
      existing.court,
    ),
    caseState: pickStr(
      "caseState" in source ? source.caseState : undefined,
      existing.caseState,
    ),
    address: cleanAddress(
      pickStr(source.address, existing.address) || existing.address,
    ),
    totalUnits: pickNum(source.totalUnits, existing.totalUnits),
    usage: pickStr(source.usage, existing.usage),
    area: pickStr(source.area, existing.area),
    sharedArea: pickStr(source.sharedArea, existing.sharedArea),
    builtYear:
      options?.preserveExistingIfEmpty &&
      (source.builtYear == null ||
        !Number.isFinite(source.builtYear) ||
        source.builtYear === 0) &&
      existing.builtYear > 0
        ? existing.builtYear
        : source.builtYear != null && Number.isFinite(source.builtYear)
          ? source.builtYear
          : existing.builtYear,
    bidDate: pickStr(source.bidDate, existing.bidDate),
    appraisedValue: pickNum(source.appraisedValue, existing.appraisedValue),
    minPrice: pickNum(source.minPrice, existing.minPrice),
    salePrice:
      source.salePrice !== undefined
        ? pickNullableNum(source.salePrice, existing.salePrice)
        : existing.salePrice,
    naverPrice: pickNum(source.naverPrice, existing.naverPrice),
    naverPriceFloor:
      source.naverPriceFloor !== undefined
        ? source.naverPriceFloor
        : existing.naverPriceFloor,
    naverPriceFloorLabel:
      source.naverPriceFloorLabel !== undefined
        ? source.naverPriceFloorLabel
        : existing.naverPriceFloorLabel,
    naverId: (() => {
      if (source.naverId === undefined || source.naverId === null) {
        return existing.naverId;
      }
      const next = String(source.naverId).trim();
      if (options?.preserveExistingIfEmpty && !next && existing.naverId) {
        return existing.naverId;
      }
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
      pickStr(source.elevator, existing.elevator),
      pickStr(source.parking, existing.parking),
    ).elevator,
    parking: cleanElevatorAndParking(
      pickStr(source.elevator, existing.elevator),
      pickStr(source.parking, existing.parking),
    ).parking,
    landShare: pickStr(source.landShare, existing.landShare),
    buildingRegistry: cleanBuildingRegistry(
      pickStr(source.buildingRegistry, existing.buildingRegistry),
    ),
    education: cleanEducation(pickStr(source.education, existing.education)),
    tradingCount: pickStr(source.tradingCount, existing.tradingCount),
    bidInfo: pickStr(source.bidInfo, existing.bidInfo),
    owner: pickStr(source.owner, existing.owner),
    appraiser: pickStr(source.appraiser, existing.appraiser),
    officialLandPrice: pickNum(
      source.officialLandPrice,
      existing.officialLandPrice,
    ),
    tenantInfo: pickStr(source.tenantInfo, existing.tenantInfo),
    specialNote: pickStr(source.specialNote, existing.specialNote),
    unpaidFeeAmount: pickNum(
      (source as Partial<UpdateAuctionDto>).unpaidFeeAmount,
      existing.unpaidFeeAmount,
      false,
    ),
    unpaidFeeNote: pickStr(
      (source as Partial<UpdateAuctionDto>).unpaidFeeNote,
      existing.unpaidFeeNote,
    ),
    unpaidFeeCheckedAt: pickStr(
      (source as Partial<UpdateAuctionDto>).unpaidFeeCheckedAt,
      existing.unpaidFeeCheckedAt,
    ),
    // 새 값이 있으면(빈 문자열이 아니면) 갱신, 없으면 기존 값 유지 —
    // 매번 크롤링에서 이 필드들이 전부 파싱된다는 보장이 없으므로
    // (예: histInfo에 sta=1216이 아직 없는 진행중 물건) 빈 값으로
    // 덮어써서 이미 확보한 값을 지우지 않는다.
    lawdCd: (source as Partial<UpdateAuctionDto>).lawdCd || existing.lawdCd,
    umdNm: (source as Partial<UpdateAuctionDto>).umdNm || existing.umdNm,
    jibun: (source as Partial<UpdateAuctionDto>).jibun || existing.jibun,
    saleConfirmedAt:
      (source as Partial<UpdateAuctionDto>).saleConfirmedAt || existing.saleConfirmedAt,
    paymentCompletedAt:
      (source as Partial<UpdateAuctionDto>).paymentCompletedAt || existing.paymentCompletedAt,
    tenantDetail: cleanTenantDetail(
      pickStr(source.tenantDetail, existing.tenantDetail),
    ),
    priceDetail: pickStr(source.priceDetail, existing.priceDetail),
    tradingDetail: pickStr(source.tradingDetail, existing.tradingDetail),
    recordTime: pickStr(source.recordTime, existing.recordTime),
    isRedevelopment:
      (source as Partial<UpdateAuctionDto>).isRedevelopment !== undefined
        ? (source as Partial<UpdateAuctionDto>).isRedevelopment
        : existing.isRedevelopment,
    extraData:
      (source as Partial<UpdateAuctionDto>).extraData !== undefined
        ? (source as Partial<UpdateAuctionDto>).extraData
        : existing.extraData,
  };

  if (
    options?.preserveExistingIfEmpty &&
    !hasNaverPrice(source.naverPrice) &&
    hasNaverPrice(existing.naverPrice)
  ) {
    merged.naverPrice = existing.naverPrice;
    merged.naverPriceFloor = existing.naverPriceFloor;
    merged.naverPriceFloorLabel = existing.naverPriceFloorLabel;
    merged.naverId = existing.naverId;
    merged.priceDetail = existing.priceDetail;
    merged.tradingDetail = existing.tradingDetail;
    merged.tradingCount = existing.tradingCount;
  }

  return merged;
}

export function buildAuctionEntity(
  parsed: Partial<AuctionRow> | UpdateAuctionDto,
  meta: CreateMeta,
): Auction {
  const auction = new Auction();
  const { city, district, propType } = parseAddressMeta(parsed.address ?? "", parsed.usage ?? "");
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
    court: ("court" in parsed ? parsed.court : "") ?? "",
    caseState: ("caseState" in parsed ? parsed.caseState : "") ?? "",
    auctionNoNorm: normalizeAuctionNo(
      parsed.auctionNo ?? "",
      "court" in parsed ? parsed.court : "",
    ),
    address: cleanAddress(parsed.address ?? ""),
    totalUnits: parsed.totalUnits ?? 0,
    usage: parsed.usage ?? "",
    area: parsed.area ?? "",
    sharedArea: parsed.sharedArea ?? "",
    builtYear: parsed.builtYear ?? 0,
    bidDate: parsed.bidDate ?? "",
    appraisedValue: parsed.appraisedValue ?? 0,
    minPrice: parsed.minPrice ?? 0,
    salePrice: parsed.salePrice ?? null,
    naverPrice: parsed.naverPrice ?? 0,
    naverPriceFloor: parsed.naverPriceFloor ?? null,
    naverPriceFloorLabel: parsed.naverPriceFloorLabel ?? null,
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
    unpaidFeeAmount: (parsed as Partial<UpdateAuctionDto>).unpaidFeeAmount ?? 0,
    unpaidFeeNote: (parsed as Partial<UpdateAuctionDto>).unpaidFeeNote ?? "",
    unpaidFeeCheckedAt: (parsed as Partial<UpdateAuctionDto>).unpaidFeeCheckedAt ?? "",
    lawdCd: (parsed as Partial<UpdateAuctionDto>).lawdCd ?? null,
    umdNm: (parsed as Partial<UpdateAuctionDto>).umdNm ?? null,
    jibun: (parsed as Partial<UpdateAuctionDto>).jibun ?? null,
    saleConfirmedAt: (parsed as Partial<UpdateAuctionDto>).saleConfirmedAt ?? null,
    paymentCompletedAt: (parsed as Partial<UpdateAuctionDto>).paymentCompletedAt ?? null,
    tenantDetail: cleanTenantDetail(parsed.tenantDetail ?? ""),
    priceDetail: parsed.priceDetail ?? "",
    tradingDetail: parsed.tradingDetail ?? "",
    recordTime: parsed.recordTime ?? "",
    isRedevelopment: (parsed as Partial<UpdateAuctionDto>).isRedevelopment ?? false,
    extraData: (parsed as Partial<UpdateAuctionDto>).extraData ?? null,
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
