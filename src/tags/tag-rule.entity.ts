import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

export type TagCategory = "fact" | "strategy";

/**
 * 태그 하나(예: "85㎡ 초과")를 생성하는 단일 조건 규칙.
 * field/operator/value 조합만으로 Auction 레코드를 평가한다(자유 코드 없음).
 * strategy 카테고리는 현재 UI/엔진에서 생성하지 않고 구조만 열어둔다(AI가 채울 예정).
 */
@Entity("tag_rules")
export class TagRule {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  tagName!: string;

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
