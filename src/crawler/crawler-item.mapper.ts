import type { UpdateAuctionDto } from "../auctions/update-auction.dto";
import { parseBuiltYear } from "../auctions/excel-columns";
import { cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail, cleanElevatorAndParking } from "../auctions/address-parser";
import { hasNaverPrice } from "../auctions/naver-price.util";
import { normalizeCrawlAuctionNo } from "../auctions/crawl-item-validation.util";
import { parseUnitFloorFromAddress, selectFloorAwareNaverPrice } from "../auctions/naver-floor-price.util";

function str(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function num(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value);
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parseTradingCount(value: unknown): string {
  return str(value);
}

export function mapCrawledItem(raw: Record<string, unknown>): Partial<UpdateAuctionDto> {
  const builtYear =
    parseBuiltYear(raw.builtYear) ??
    parseBuiltYear(raw.build_year) ??
    0;

  const { elevator, parking } = cleanElevatorAndParking(
    str(raw.elevator),
    str(raw.parking),
  );

  let naverPrice = num(raw.naverPrice ?? raw.naver_lowest_price);
  let naverPriceFloor: number | null = null;
  let floorOverrideApplied = false;

  const usage = str(raw.usage);
  const address = cleanAddress(str(raw.address));
  const priceDetail = str(raw.priceDetail ?? raw.naver_price_detail);

  if (usage === "아파트" && priceDetail) {
    const targetFloor = parseUnitFloorFromAddress(address);
    const floorAware = selectFloorAwareNaverPrice(priceDetail, targetFloor);
    if (floorAware.naverPrice != null) {
      naverPrice = floorAware.naverPrice;
      naverPriceFloor = floorAware.naverPriceFloor;
      floorOverrideApplied = true;
    }
  }

  const hasNaver = hasNaverPrice(naverPrice);
  const rawAuctionNo = str(raw.auctionNo ?? raw.auction_no);
  const auctionNo = normalizeCrawlAuctionNo(rawAuctionNo) ?? rawAuctionNo;

  const minPrice = num(raw.minPrice ?? raw.min_price);
  const appraisedValue = num(raw.appraisedValue ?? raw.appraisal_price);
  const salePrice = numOrNull(raw.salePrice ?? raw.sale_price);

  // 층수 기반으로 naverPrice를 재계산했으면, python이 계산한 갭(예전 naverPrice 기준)
  // 대신 새 naverPrice로 직접 다시 계산한다(merge 단계에서 기존 DB 값으로 되돌아가지 않도록
  // undefined가 아닌 확정값으로 채운다).
  const diffNaverSale = floorOverrideApplied
    ? salePrice != null
      ? naverPrice - salePrice
      : null
    : hasNaver
      ? numOrNull(raw.diffNaverSale ?? raw.gap_margin_sold_price)
      : null;
  const diffNaverMin = floorOverrideApplied
    ? naverPrice - minPrice
    : hasNaver
      ? num(raw.diffNaverMin ?? raw.gap_margin)
      : 0;
  const diffNaverAppraised = floorOverrideApplied
    ? naverPrice - appraisedValue
    : hasNaver
      ? num(raw.diffNaverAppraised ?? raw.new_case_gap_margin)
      : 0;

  return {
    memo: str(raw.memo),
    link: str(raw.link),
    views: num(raw.views),
    auctionNo: auctionNo,
    address,
    totalUnits: num(raw.totalUnits ?? raw.total_units),
    usage,
    area: str(raw.area),
    builtYear: builtYear || 0,
    bidDate: str(raw.bidDate ?? raw.bid_date),
    appraisedValue,
    minPrice,
    salePrice,
    naverPrice,
    naverPriceFloor,
    naverId: str(raw.naverId ?? raw.naver_id),
    diffNaverSale,
    diffNaverMin,
    diffNaverAppraised,
    tradingCount: parseTradingCount(raw.tradingCount ?? raw.real_trade_count),
    bidInfo: str(raw.bidInfo ?? raw.bid_info),
    owner: str(raw.owner),
    appraiser: str(raw.appraiser),
    officialLandPrice: num(raw.officialLandPrice ?? raw.official_land_price),
    tenantInfo: str(raw.tenantInfo ?? raw.tenant_info),
    specialNote: str(raw.specialNote ?? raw.special_note),
    elevator,
    parking,
    landShare: str(raw.landShare ?? raw.land_area),
    buildingRegistry: cleanBuildingRegistry(
      str(raw.buildingRegistry ?? raw.deunggi_info),
    ),
    education: cleanEducation(str(raw.education ?? raw.education_setup)),
    tenantDetail: cleanTenantDetail(str(raw.tenantDetail ?? raw.lease_info)),
    priceDetail,
    tradingDetail: str(raw.tradingDetail ?? raw.transaction_prices),
    recordTime: str(raw.recordTime ?? raw.record_time),
  };
}
