import { Entity, PrimaryColumn, Column } from "typeorm";

/** 대출 정책 관련 전역 설정값(key-value). 소득 기반 대출 배수 등. */
@Entity("loan_settings")
export class LoanSettings {
  @PrimaryColumn()
  key!: string;

  @Column({ type: "real" })
  value!: number;
}
