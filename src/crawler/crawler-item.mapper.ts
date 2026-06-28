import type { UpdateAuctionDto } from "../auctions/update-auction.dto";
import { parseBuiltYear } from "../auctions/excel-columns";
import { cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail, cleanElevatorAndParking } from "../auctions/address-parser";

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

  return {
    memo: str(raw.memo),
    link: str(raw.link),
    views: num(raw.views),
    auctionNo: str(raw.auctionNo ?? raw.auction_no),
    address: cleanAddress(str(raw.address)),
    totalUnits: num(raw.totalUnits ?? raw.total_units),
    usage: str(raw.usage),
    area: str(raw.area),
    builtYear: builtYear || 0,
    bidDate: str(raw.bidDate ?? raw.bid_date),
    appraisedValue: num(raw.appraisedValue ?? raw.appraisal_price),
    minPrice: num(raw.minPrice ?? raw.min_price),
    salePrice: numOrNull(raw.salePrice ?? raw.sale_price),
    naverPrice: num(raw.naverPrice ?? raw.naver_lowest_price),
    naverId: str(raw.naverId ?? raw.naver_id),
    diffNaverSale: numOrNull(raw.diffNaverSale ?? raw.gap_margin_sold_price),
    diffNaverMin: num(raw.diffNaverMin ?? raw.gap_margin),
    diffNaverAppraised: num(raw.diffNaverAppraised ?? raw.new_case_gap_margin),
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
    priceDetail: str(raw.priceDetail ?? raw.naver_price_detail),
    tradingDetail: str(raw.tradingDetail ?? raw.transaction_prices),
    recordTime: str(raw.recordTime ?? raw.record_time),
  };
}
