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

  @CreateDateColumn()
  createdAt!: Date;
}
