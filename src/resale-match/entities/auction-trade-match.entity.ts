import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/** 낙찰물건 매도 추정 기능의 매칭 결과 — 평가된 후보 전부를 저장해
 * 감사·튜닝이 가능하게 한다(1등만 저장하지 않음). 설계:
 * docs/auction-resale-matching-design.md 6.4절. */
@Entity("auction_trade_match")
@Index("UQ_auction_trade_match_pair", ["auctionId", "actualTradeId"], { unique: true })
@Index("IDX_auction_trade_match_status", ["status"])
export class AuctionTradeMatchRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  auctionId!: string;

  @Column({ type: "uuid" })
  actualTradeId!: string;

  @Column({ type: "uuid", nullable: true })
  listingSnapshotId!: string | null;

  /** 1 = 이 auction에 대한 최고점 후보. */
  @Column({ type: "integer" })
  candidateRank!: number;

  /** 0~100. */
  @Column({ type: "integer" })
  scoreTotal!: number;

  /** {area, floor, time, price, uniqueness, listingLink, penalties: [...]}
   * — 서브스코어 원본값까지 감사용으로 남긴다. */
  /** simple-json은 운영 PostgreSQL과 로컬 sql.js 양쪽에서 동작한다. */
  @Column({ type: "simple-json" })
  scoreBreakdown!: Record<string, unknown>;

  @Column()
  confidenceTier!: "VERY_HIGH" | "HIGH" | "MEDIUM" | "LOW";

  @Column({ default: false })
  isPreCompletion!: boolean;

  /** 사용자 화면 노출 여부(설계 문서 4.5절 정책 반영 결과). */
  @Column({ default: false })
  isDisplayed!: boolean;

  @Column({ default: "CANDIDATE" })
  status!: "CANDIDATE" | "CONFIRMED" | "REJECTED" | "SUPERSEDED";

  @Column({ type: "text", nullable: true })
  reviewedBy!: string | null;

  @Column({ type: Date, nullable: true })
  reviewedAt!: Date | null;

  @Column({ type: Date })
  computedAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;
}
