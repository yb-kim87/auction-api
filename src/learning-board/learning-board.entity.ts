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
  @Column({ type: "text", default: "" }) safetyResearch1!: string;
  @Column({ type: "text", default: "" }) safetyResearch2!: string;
  @Column({ type: "text", default: "" }) safetyResearch3!: string;
  @Column({ type: "text", default: "" }) finalSafetyMargin!: string;
  @Column({ type: "bigint", default: 0 }) finalMarketPrice!: number;
  @Column({ type: "bigint", default: 0 }) targetBidPrice!: number;
  @Column({ type: "bigint", default: 0 }) requiredEquity!: number;
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
