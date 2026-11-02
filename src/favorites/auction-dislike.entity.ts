import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** 사용자가 경매물건에 "싫어요"를 누르고 남긴 사유 — 관심(auction_favorites)과 별개로 관리한다(사용자 요청, 2026-11-02). */
@Entity("auction_dislikes")
@Unique(["userId", "auctionId"])
export class AuctionDislike {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @Column()
  auctionId!: string;

  @Column({ type: "text", nullable: true })
  reason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
