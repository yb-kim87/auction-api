import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

/**
 * Strategy 코드를 사용자에게 보여줄 실제 문구로 변환하는 표시 레이어.
 * 예: COMPETITION_LOW_POSSIBLE → label="경쟁이 적은 투자", description="세금 계산을
 * 어려워하는 입찰자가 적어 경쟁이 낮아질 수 있습니다."
 *
 * 코드와 문구를 분리해두면, 이후 AI가 strategyCode만 정확히 채우면 되고 문구는 관리자가
 * 마케팅 톤으로 자유롭게 다듬을 수 있다.
 */
@Entity("strategy_labels")
export class StrategyLabel {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  strategyCode!: string;

  /** 사용자 노출용 짧은 배지 문구(예: "경쟁이 적은 투자") */
  @Column()
  label!: string;

  /** 사용자 노출용 설명 문구 */
  @Column({ type: "text", default: "" })
  description!: string;

  /** 배지 아이콘 힌트(프론트에서 매핑, 예: "gem") */
  @Column({ default: "" })
  icon!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
