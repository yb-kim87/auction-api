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

  @CreateDateColumn()
  createdAt!: Date;
}
