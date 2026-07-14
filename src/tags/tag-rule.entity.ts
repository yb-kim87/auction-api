import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type TagCategory = "fact" | "strategy";

/**
 * Fact 태그 하나(예: "85㎡ 초과")를 생성하는 단일 조건 규칙.
 * field/operator/value 조합만으로 Auction 레코드를 평가한다(자유 코드 없음).
 *
 * Fact 태그는 내부 판단용 코드이며 사용자에게 직접 노출하지 않는다(전용면적>85㎡ 자체가
 * 아니라, 이를 근거로 한 투자 전략 문구를 사용자에게 보여준다 — strategy-rule.entity.ts,
 * strategy-label.entity.ts 참고). tagCode는 StrategyRule의 requiredFactCodes에서 참조하는
 * 안정적인 식별자(예: AREA_OVER_85)이고, tagName은 관리자 화면에 보이는 한글 라벨이다.
 */
@Entity("tag_rules")
export class TagRule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 관리자 화면 표시용 한글 라벨(예: "85㎡ 초과") */
  @Column()
  tagName!: string;

  /** StrategyRule이 참조하는 안정적 코드(예: AREA_OVER_85). 미입력 시 서비스가 자동 생성 */
  @Column({ unique: true })
  tagCode!: string;

  @Column({ default: "fact" })
  category!: TagCategory;

  /** RULE_FIELDS(rule-field-registry.ts)에 정의된 키만 허용 */
  @Column()
  field!: string;

  /** RULE_OPERATORS에 정의된 연산자만 허용 */
  @Column()
  operator!: string;

  /** 필드 타입에 맞는 문자열(숫자/불리언/문자열 모두 문자열로 저장 후 평가 시 캐스팅) */
  @Column()
  value!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
