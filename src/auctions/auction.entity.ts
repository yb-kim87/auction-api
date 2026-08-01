import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  AfterLoad,
} from "typeorm";
import { AuctionStatus } from "../common/constants";
import { cleanAddress, cleanEducation, cleanBuildingRegistry, cleanTenantDetail, cleanElevatorAndParking } from "./address-parser";

export interface StrategyTagItem {
  code: string;
  label: string;
  description: string;
  icon: string;
}

export type RightsReviewStatus =
  | "uninvestigated"
  | "in_progress"
  | "none"
  | "confirmed"
  | "unverifiable";

export interface AuctionRightsReview {
  status: RightsReviewStatus;
  baselineRightType: string;
  baselineRightDate: string;
  seniorTenantStatus: "unknown" | "none" | "possible" | "confirmed";
  opposabilityStatus: "unknown" | "none" | "possible" | "confirmed";
  depositAmount: number | null;
  expectedDividendAmount: number | null;
  assumptionAmount: number | null;
  specialRights: string;
  evidenceNote: string;
  confirmedAt: string;
  confirmedBy: string;
}

/** bigint 컬럼은 pg 드라이버가 문자열로 반환하므로 number로 왕복 변환한다. */
const bigintNumberTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value == null ? value : Number(value)),
};

@Entity("auctions")
export class Auction {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ default: "" })
  memo!: string;

  @Column({ default: "" })
  link!: string;

  @Column({ type: "integer", default: 0 })
  views!: number;

  @Column({ default: "" })
  auctionNo!: string;

  /** 담당 법원+계(예: "수원지방법원 9계"). 사건번호는 법원마다 독립적으로
   * 채번되어 서로 다른 법원의 사건이 같은 번호를 쓸 수 있으므로,
   * auctionNoNorm(물건 식별 고유 키)을 만들 때 사건번호와 함께 반드시
   * 같이 써야 한다 — 안 그러면 서로 다른 물건이 같은 물건으로 취급되어
   * 덮어써지는 사고가 난다(실측: "2025타경12336"이 서울북부2계·서울남부4계·
   * 천안7계에 각각 별개로 존재, 2026-07-19). */
  @Column({ default: "" })
  court!: string;

  /** 탱크옥션 baseInfo.stateNm 원문(예: "진행", "변경", "취하", "매각").
   * 취하·매각(낙찰허가 확정)은 사건이 종결되어 더 이상 입찰기일이 다시
   * 잡히지 않으므로 "당일물건 조회"(재크롤링) 대상에서 제외하는 데 쓴다.
   * "변경"은 다음 매각기일이 다시 잡힐 수 있어 계속 재확인 대상이다. */
  @Column({ default: "" })
  caseState!: string;

  @Index({ unique: true })
  @Column({ type: "text", nullable: true })
  auctionNoNorm!: string | null;

  @Column({ default: false })
  isUpdated!: boolean;

  @Column({ type: Date, nullable: true })
  updatedAt!: Date | null;

  @Column({ default: "" })
  updatedBy!: string;

  @Column({ default: "" })
  address!: string;

  @Column({ type: "integer", default: 0 })
  totalUnits!: number;

  @Column({ default: "" })
  usage!: string;

  @Column({ default: "" })
  area!: string;

  @Column({ default: "" })
  sharedArea!: string;

  @Column({ type: "integer", default: 0 })
  builtYear!: number;

  /** 부가세계산기 자동계산에서 조회한 PNU(19자리)·구조명·주용도명·지상
   * 층수 — 물건 고유값이라 한 번 확보하면 바뀌지 않으므로 캐싱해 다음
   * 자동계산부터는 VWorld 좌표변환+건축물대장 API 호출을 생략한다.
   * 토지공시지가는 매년 갱신될 수 있어 캐싱하지 않고 항상 API로 새로
   * 받는다(사용자 요청, 2026-07-24). */
  @Column({ type: "text", nullable: true })
  vatPnu!: string | null;

  @Column({ type: "text", nullable: true })
  vatStructureName!: string | null;

  @Column({ type: "text", nullable: true })
  vatMainPurposeName!: string | null;

  @Column({ type: "integer", nullable: true })
  vatGroundFloors!: number | null;

  @Column({ default: "" })
  bidDate!: string;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  appraisedValue!: number;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  minPrice!: number;

  @Column({ type: "bigint", nullable: true, transformer: bigintNumberTransformer })
  salePrice!: number | null;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  naverPrice!: number;

  @Column({ type: "integer", nullable: true })
  naverPriceFloor!: number | null;

  @Column({ type: "text", nullable: true })
  naverPriceFloorLabel!: string | null;

  @Column({ default: "" })
  naverId!: string;

  @Column({ type: "bigint", nullable: true, transformer: bigintNumberTransformer })
  diffNaverSale!: number | null;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  diffNaverMin!: number;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  diffNaverAppraised!: number;

  @Column({ default: "" })
  elevator!: string;

  @Column({ default: "" })
  parking!: string;

  @Column({ default: "" })
  landShare!: string;

  @Column({ default: "" })
  buildingRegistry!: string;

  @Column({ default: "" })
  education!: string;

  @Column({ default: "" })
  tradingCount!: string;

  @Column({ default: "" })
  bidInfo!: string;

  @Column({ default: "" })
  owner!: string;

  @Column({ default: "" })
  appraiser!: string;

  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  officialLandPrice!: number;

  @Column({ default: "" })
  tenantInfo!: string;

  @Column({ default: "" })
  specialNote!: string;

  @Column({ default: "" })
  tenantDetail!: string;

  /** tenantDetail 원문(법률 용어 위주)을 AI가 1~2문장으로 쉽게 풀어쓴
   * 요약. 물건당 한 번만 생성해 캐싱하고(요청마다 재호출하지 않음),
   * tenantDetail이 바뀌면 재생성이 필요할 수 있다. */
  @Column({ type: "text", nullable: true })
  tenantSummary!: string | null;

  /** 탱크옥션이 관리사무소에 개별 문의해 조사한 미납 관리비(체납금액).
   * 조사가 안 된 물건은 원본 API(arersInfo.items)가 빈 배열이라 이 필드도
   * 전부 기본값(0/빈 문자열)으로 남는다 — 크롤링 누락이 아니라 원본
   * 데이터 자체가 없는 정상 케이스(실측, 2026-07-25). */
  @Column({ type: "bigint", default: 0, transformer: bigintNumberTransformer })
  unpaidFeeAmount!: number;

  @Column({ default: "" })
  unpaidFeeNote!: string;

  @Column({ default: "" })
  unpaidFeeCheckedAt!: string;

  /** 낙찰물건 매도 추정(재판매 매칭) 기능의 기준일. 매각대금완납일이
   * 실질적 소유권 취득 시점이라 실거래 매칭의 anchor date로 쓴다(매각
   * 허가결정일은 참고용). 완납일을 직접 못 구하면 추정치를 쓰고
   * paymentCompletedAtIsEstimated로 구분한다. 설계:
   * docs/auction-resale-matching-design.md 1장. */
  @Column({ type: "date", nullable: true })
  saleConfirmedAt!: string | null;

  @Column({ type: "date", nullable: true })
  paymentCompletedAt!: string | null;

  @Column({ default: false })
  paymentCompletedAtIsEstimated!: boolean;

  /** 국토부 실거래가 API 조회용 지번 식별자(탱크옥션 baseInfo에서 크롤링
   * 시점에 파싱: lawdCd=si_cd(2자리)+gu_cd(3자리), jibun=m_adrs_no(-s_adrs_no),
   * umdNm=regn_adrs 텍스트에서 추출). 단지명 텍스트 대신 이 3개로 실거래를
   * 조인한다(동명이인 단지 오매칭 방지). */
  @Column({ type: "text", nullable: true })
  lawdCd!: string | null;

  @Column({ type: "text", nullable: true })
  umdNm!: string | null;

  @Column({ type: "text", nullable: true })
  jibun!: string | null;

  /** 매칭 배치(ResaleMatchService)가 계산한 결과를 목록 조회용으로
   * 비정규화 저장(vatPnu 등과 동일 패턴, 요청마다 재계산하지 않음). */
  @Column({ type: "uuid", nullable: true })
  resaleMatchedTradeId!: string | null;

  @Column({ type: "integer", nullable: true })
  resaleMatchScore!: number | null;

  @Column({ type: "text", nullable: true })
  resaleMatchTier!: string | null;

  @Column({ default: "" })
  priceDetail!: string;

  @Column({ default: "" })
  tradingDetail!: string;

  @Column({ default: "" })
  recordTime!: string;

  @Column({ default: "" })
  city!: string;

  @Column({ default: "" })
  district!: string;

  @Column({ default: "아파트" })
  propType!: string;

  @Column({ type: "text", default: AuctionStatus.APPROVED })
  status!: AuctionStatus;

  @Column({ default: "" })
  submittedBy!: string;

  /** 크롤링/특이사항 텍스트로 자동 판별되지 않아 관리자가 직접 표시하는 재개발 여부 */
  @Column({ default: false })
  isRedevelopment!: boolean;

  /**
   * 규칙 기반으로 자동 계산되는 Fact 코드 배열(JSON 문자열로 저장). 예: ["AREA_OVER_85"].
   * 내부 판단용 코드일 뿐이며 사용자에게 직접 노출하지 않는다 — 사용자에게는 이 Fact를
   * 근거로 생성된 strategyTags(투자 전략 문구)를 보여준다.
   */
  @Column({ type: "text", default: "[]" })
  factTags!: string;

  /**
   * Fact 코드 조합으로 생성된, 사용자에게 노출할 투자 전략 태그 목록(JSON 문자열로 저장).
   * 원소 형태: {code, label, description, icon}. label/description이 실제 화면 문구다.
   */
  @Column({ type: "text", default: "[]" })
  strategyTags!: string;

  /** factTags를 파싱한 배열(내부용, DB 컬럼 아님, 응답에는 내려주지 않는 편이 자연스러움) */
  factTagsList!: string[];

  /** strategyTags를 파싱한 배열(응답 직렬화용, DB 컬럼 아님) — 사용자에게 실제로 보여줄 태그 */
  strategyTagsList!: StrategyTagItem[];

  /**
   * 크롤러가 수집했지만 아직 정식 컬럼으로 승격하지 않은 부가 데이터
   * (예: 이미지 경로, 관련사건 목록, 좌표 등). 검색/정렬/추천에 자주
   * 쓰이는 게 확인되면 그때 정식 컬럼으로 승격한다.
   */
  @Column({ type: "simple-json", nullable: true })
  extraData!: Record<string, unknown> | null;

  /** AI가 만든 초안과 분리해 관리자가 근거 자료로 확인한 권리분석 값.
   * 사용자 화면과 수익계산기에는 이 확정값만 사용한다. */
  @Column({ type: "simple-json", nullable: true })
  rightsReview!: AuctionRightsReview | null;

  @CreateDateColumn()
  createdAt!: Date;

  private static parseStringArray(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
    } catch {
      return [];
    }
  }

  private static parseStrategyItems(raw: string): StrategyTagItem[] {
    try {
      const parsed = JSON.parse(raw ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (v): v is StrategyTagItem =>
          v && typeof v === "object" && typeof v.code === "string" && typeof v.label === "string",
      );
    } catch {
      return [];
    }
  }

  @AfterLoad()
  normalizeDisplayFields(): void {
    // createQueryBuilder().select([...])로 일부 컬럼만 조회하는 경우(예:
    // TradeIngestionService.resolveIngestionScope) 여기서 참조하는 필드가
    // undefined일 수 있다 — 그런 부분 로드에서도 크래시하지 않도록 각
    // 필드를 선택된 경우에만 정규화한다(실측 크래시, 2026-07-28).
    if (this.address !== undefined) this.address = cleanAddress(this.address);
    if (this.education !== undefined) this.education = cleanEducation(this.education);
    if (this.buildingRegistry !== undefined) {
      this.buildingRegistry = cleanBuildingRegistry(this.buildingRegistry);
    }
    if (this.tenantDetail !== undefined) this.tenantDetail = cleanTenantDetail(this.tenantDetail);
    if (this.elevator !== undefined || this.parking !== undefined) {
      const { elevator, parking } = cleanElevatorAndParking(this.elevator, this.parking);
      this.elevator = elevator;
      this.parking = parking;
    }
    if (this.factTags !== undefined) {
      this.factTagsList = Auction.parseStringArray(this.factTags);
    }
    if (this.strategyTags !== undefined) {
      this.strategyTagsList = Auction.parseStrategyItems(this.strategyTags);
    }
  }
}
