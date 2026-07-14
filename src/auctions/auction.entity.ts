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

  /** 규칙 기반으로 자동 계산되는 객관적 사실 태그(JSON 배열 문자열로 저장). 예: ["85㎡ 초과"] */
  @Column({ type: "text", default: "[]" })
  factTags!: string;

  /** AI가 factTags 등을 종합해 생성할 투자 전략 태그(JSON 배열 문자열로 저장). 현재는 항상 빈 배열. */
  @Column({ type: "text", default: "[]" })
  strategyTags!: string;

  /** factTags를 파싱한 배열(응답 직렬화용, DB 컬럼 아님) */
  factTagsList!: string[];

  /** strategyTags를 파싱한 배열(응답 직렬화용, DB 컬럼 아님) */
  strategyTagsList!: string[];

  @CreateDateColumn()
  createdAt!: Date;

  private static parseTagsJson(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((t) => typeof t === "string") : [];
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
    this.factTagsList = Auction.parseTagsJson(this.factTags);
    this.strategyTagsList = Auction.parseTagsJson(this.strategyTags);
  }
}
