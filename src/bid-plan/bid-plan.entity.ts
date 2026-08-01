import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Unique,
} from "typeorm";

/**
 * 수익계산기에서 입력한 값을 물건+회원 단위로 저장해두는 "입찰 계획".
 * 계산기 입력값 전체는 inputsJson에 직렬화해 보관하고(항목이 자주
 * 늘어나는 계산기 특성상 컬럼을 매번 늘리지 않기 위함), 목록에서 바로
 * 보여줄 핵심 값만 별도 컬럼으로 둔다(사용자 요청, 2026-08-01).
 */
@Entity("auction_bid_plans")
@Unique(["username", "auctionId"])
export class AuctionBidPlan {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  username!: string;

  @Column()
  auctionId!: string;

  @Column({ type: "bigint", transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  bidPrice!: number;

  @Column({ type: "bigint", transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  salePrice!: number;

  @Column({
    type: "bigint",
    nullable: true,
    transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? v : Number(v)) },
  })
  finalProfit!: number | null;

  @Column({
    type: "bigint",
    nullable: true,
    transformer: { to: (v: number | null) => v, from: (v: string | null) => (v == null ? v : Number(v)) },
  })
  requiredEquity!: number | null;

  @Column({ type: "text", default: "" })
  memo!: string;

  /** 계산기의 모든 입력값(holdingMonths/loanRatio/interiorCost 등) JSON 직렬화 */
  @Column({ type: "text", default: "{}" })
  inputsJson!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
