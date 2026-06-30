import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

@Entity("auction_analyses")
@Index(["auctionId", "username"])
export class AuctionAnalysis {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  auctionId!: string;

  @Column()
  username!: string;

  @Column({ type: "text" })
  resultJson!: string;

  @Column({ default: "" })
  model!: string;

  /** 물건 데이터 변경 시 캐시 무효화 판단용 */
  @Column({ type: Date, nullable: true })
  auctionSnapshotAt!: Date | null;

  /** 경매지식 변경 시 캐시 무효화 판단용 */
  @Column({ type: Date, nullable: true })
  knowledgeMaxUpdatedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
