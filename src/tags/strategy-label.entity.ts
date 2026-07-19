import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

/**
 * 사용자에게 노출할 짧은 배지 문구(라벨) 마스터. 관리자가 미리 등록해두고, 전략 규칙을
 * 만들 때 이 목록에서 골라 연결한다(직접 타이핑하지 않음). 같은 라벨을 여러 전략
 * 규칙이 동시에 재사용할 수 있는 다대다 관계이며, 연결은 StrategyRule.labelId가
 * 가진다(여기서는 어떤 전략에 쓰이는지 알 수 없다 — 조회 시 StrategyRule 쪽에서
 * labelId로 역참조).
 * 설명(description)은 전략마다 다를 수 있어 라벨이 아니라 StrategyRule에 속한다.
 *
 * 예: COMPETITION_LOW_POSSIBLE → label="경쟁이 적은 투자"
 */
@Entity("strategy_labels")
export class StrategyLabel {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** @deprecated 다대다 전환(2026-07-19) 이전의 단일 연결 흔적. 더 이상 쓰지 않음
   * (연결은 StrategyRule.labelId가 담당). 마이그레이션 호환을 위해 컬럼만 유지. */
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
