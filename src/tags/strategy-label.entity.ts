import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

/**
 * 사용자에게 노출할 짧은 배지 문구(라벨) 마스터. 관리자가 미리 등록해두고, 전략 규칙을
 * 만들 때 이 목록에서 골라 strategyCode에 연결한다(직접 타이핑하지 않음).
 * 같은 라벨을 여러 전략 규칙이 재사용할 수 있어 strategyCode가 unique가 아니다.
 * 설명(description)은 전략마다 다를 수 있어 라벨이 아니라 StrategyRule에 속한다.
 *
 * 예: COMPETITION_LOW_POSSIBLE → label="경쟁이 적은 투자"
 */
@Entity("strategy_labels")
export class StrategyLabel {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 이 라벨이 현재 연결된 전략 코드(마지막 연결 기준, 없으면 미사용 라벨) */
  @Column({ default: "" })
  strategyCode!: string;

  /** 사용자 노출용 짧은 배지 문구(예: "경쟁이 적은 투자") */
  @Column()
  label!: string;

  /** @deprecated 설명은 이제 StrategyRule.description에서 관리한다. 하위 호환용으로만 남김. */
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
