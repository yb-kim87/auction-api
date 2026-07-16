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

  @Column({ type: "integer", default: 0 })
  builtYear!: number;

  @Column({ default: "" })
  bidDate!: string;

  @Column({ type: "integer", default: 0 })
  appraisedValue!: number;

  @Column({ type: "integer", default: 0 })
  minPrice!: number;

  @Column({ type: "integer", nullable: true })
  salePrice!: number | null;

  @Column({ type: "integer", default: 0 })
  naverPrice!: number;

  @Column({ type: "integer", nullable: true })
  naverPriceFloor!: number | null;

  @Column({ type: "text", nullable: true })
  naverPriceFloorLabel!: string | null;

  @Column({ default: "" })
  naverId!: string;

  @Column({ type: "integer", nullable: true })
  diffNaverSale!: number | null;

  @Column({ type: "integer", default: 0 })
  diffNaverMin!: number;

  @Column({ type: "integer", default: 0 })
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

  @Column({ type: "integer", default: 0 })
  officialLandPrice!: number;

  @Column({ default: "" })
  tenantInfo!: string;

  @Column({ default: "" })
  specialNote!: string;

  @Column({ default: "" })
  tenantDetail!: string;

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
    this.address = cleanAddress(this.address);
    this.education = cleanEducation(this.education);
    this.buildingRegistry = cleanBuildingRegistry(this.buildingRegistry);
    this.tenantDetail = cleanTenantDetail(this.tenantDetail);
    const { elevator, parking } = cleanElevatorAndParking(this.elevator, this.parking);
    this.elevator = elevator;
    this.parking = parking;
    this.factTagsList = Auction.parseStringArray(this.factTags);
    this.strategyTagsList = Auction.parseStrategyItems(this.strategyTags);
  }
}
