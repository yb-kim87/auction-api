import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

/**
 * Fact 태그 코드 조합(AND)으로 Strategy 코드를 생성하는 규칙.
 * 예: requiredFactCodes = ["AREA_OVER_85"] → strategyCode = "COMPETITION_LOW_POSSIBLE"
 *
 * 지금은 이 규칙들이 순수 코드 매핑(AI 없이)으로 동작하지만, 향후 등기분석·권리분석·
 * 시세분석·입찰경쟁률처럼 더 복잡한 종합 판단이 필요한 Strategy는 AI가 별도로 생성해
 * 같은 strategyCode 네임스페이스에 채워 넣는 방식으로 확장할 수 있다.
 */
@Entity("strategy_rules")
export class StrategyRule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 결과로 부여할 Strategy 코드(예: COMPETITION_LOW_POSSIBLE). StrategyLabel과 매칭 */
  @Column()
  strategyCode!: string;

  /** 이 Fact 코드들을 모두 가지고 있어야 매칭(AND). JSON 배열 문자열로 저장 */
  @Column({ type: "text" })
  requiredFactCodes!: string;

  /** 사용자 노출용 설명 문구(전략마다 다르므로 라벨이 아니라 여기에 속함) */
  @Column({ type: "text", default: "" })
  description!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
