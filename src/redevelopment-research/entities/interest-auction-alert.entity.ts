import { Column, Entity, PrimaryColumn } from "typeorm";

@Entity("interest_auction_alerts")
export class InterestAuctionAlert {
  @PrimaryColumn({ type: "varchar" }) auctionId!: string;
  @Column({ type: "text", default: "pending" }) status!: string;
  @Column({ type: "int", default: 0 }) attempts!: number;
  @Column({ type: Date }) nextAttemptAt!: Date;
  @Column({ type: Date }) createdAt!: Date;
  @Column({ type: Date, nullable: true }) sentAt!: Date | null;
  @Column({ type: "text", nullable: true }) lastError!: string | null;
}
