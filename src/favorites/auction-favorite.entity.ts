import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Unique,
} from "typeorm";

@Entity("auction_favorites")
@Unique(["userId", "auctionId"])
export class AuctionFavorite {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  userId!: string;

  @Column()
  auctionId!: string;

  /** 사용자가 관심등록 시 직접 입력한 분류 태그(자유 텍스트, 선택). */
  @Column({ type: "varchar", nullable: true })
  category!: string | null;

  /** 관심등록 시 남긴 메모(자유 텍스트, 선택) — 내 물건 목록과 물건
   * 상세 상단에서 바로 볼 수 있다(사용자 요청, 2026-08-04). */
  @Column({ type: "text", nullable: true })
  memo!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}
