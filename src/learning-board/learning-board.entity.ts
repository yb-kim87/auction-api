import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("auction_assignments")
export class AuctionAssignment {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() username!: string;
  @Column({ default: "" }) auctionId!: string;
  @Column({ default: "" }) auctionNo!: string;
  @Column({ default: "" }) address!: string;
  @Column({ type: "text", default: "" }) marketResearch!: string;
  @Column({ type: "text", default: "" }) phoneResearch!: string;
  @Column({ type: "text", default: "" }) phoneBuyer!: string;
  @Column({ type: "text", default: "" }) phoneSeller!: string;
  @Column({ type: "text", default: "" }) phoneBidder!: string;
  @Column({ type: "text", default: "" }) phoneFinal!: string;
  // safetyResearchN은 조사 N건의 안전마진(시세-낙찰가) 값을 저장한다.
  // 사건번호/시세/낙찰가는 각각 별도 컬럼으로 받아 안전마진을 프론트에서
  // 자동 계산해 넣는다(사용자 요청, 2026-08-15: "조사 하나당 4개칸을
  // 입력을 할껀데 순서는 경매사건번호 -> 시세 -> 낙찰가 -> 안전마진").
  @Column({ type: "text", default: "" }) safetyResearch1!: string;
  @Column({ type: "text", default: "" }) safetyResearch1CaseNo!: string;
  @Column({ type: "bigint", default: 0 }) safetyResearch1MarketPrice!: number;
  @Column({ type: "bigint", default: 0 }) safetyResearch1BidPrice!: number;
  @Column({ type: "text", default: "" }) safetyResearch2!: string;
  @Column({ type: "text", default: "" }) safetyResearch2CaseNo!: string;
  @Column({ type: "bigint", default: 0 }) safetyResearch2MarketPrice!: number;
  @Column({ type: "bigint", default: 0 }) safetyResearch2BidPrice!: number;
  @Column({ type: "text", default: "" }) safetyResearch3!: string;
  @Column({ type: "text", default: "" }) safetyResearch3CaseNo!: string;
  @Column({ type: "bigint", default: 0 }) safetyResearch3MarketPrice!: number;
  @Column({ type: "bigint", default: 0 }) safetyResearch3BidPrice!: number;
  @Column({ type: "text", default: "" }) finalSafetyMargin!: string;
  @Column({ type: "bigint", default: 0 }) finalMarketPrice!: number;
  @Column({ type: "bigint", default: 0 }) targetBidPrice!: number;
  @Column({ type: "bigint", default: 0 }) requiredEquity!: number;
  @Column({ type: "bigint", default: 0 }) finalProfit!: number;
  @Column({ type: "text", default: "" }) memo!: string;
  @Column({ default: "draft" }) status!: string;
  @Column({ type: "text", default: "" }) coachFeedback!: string;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}

@Entity("service_reports")
export class ServiceReport {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column() username!: string;
  @Column({ default: "bug" }) type!: string;
  @Column() title!: string;
  @Column({ type: "text", default: "" }) description!: string;
  @Column({ type: "text", default: "" }) reproduction!: string;
  @Column({ type: "text", default: "" }) expectedResult!: string;
  @Column({ type: "text", default: "" }) actualResult!: string;
  @Column({ type: "text", default: "" }) pageUrl!: string;
  @Column({ default: "received" }) status!: string;
  @Column({ type: "text", default: "" }) adminReply!: string;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
