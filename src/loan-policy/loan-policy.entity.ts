import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity("loan_policies")
export class LoanPolicy {
  @PrimaryColumn()
  id!: string;

  @Column()
  label!: string;

  /** 낙찰가(최저가) 대비 대출 가능 비율. 대출 불가 정책(예: 규제지역 1주택 이상)은 0. */
  @Column({ type: "real" })
  loanRatio!: number;

  /** 감정가 대비 대출 가능 비율. 실제 대출한도는 min(감정가×이 비율, 낙찰가×loanRatio)로
   *  계산한다. 규제지역 무주택처럼 감정가 비율만 적용되는 정책은 loanRatio를 매우 큰 값
   *  (사실상 무제한)으로 두어 감정가 기준이 항상 낮게 걸리도록 한다. */
  @Column({ type: "real", default: 1 })
  appraisalRatio!: number;

  /** 규제지역 여부. 물건의 regulatedArea와 매칭해 정책을 선택하는 기준. */
  @Column({ type: "boolean", default: false })
  regulatedArea!: boolean;

  /** 대출 자체가 불가능한 정책(예: 규제지역 1주택 이상). true면 관리자 화면에서
   *  비율 편집 없이 "대출 불가"로 고정 표시한다. */
  @Column({ type: "boolean", default: false })
  loanUnavailable!: boolean;

  /** 사업자 대출로만 가능한 정책(비규제 1주택 이상). 안내 문구 표시용. */
  @Column({ type: "boolean", default: false })
  businessLoanOnly!: boolean;

  /** 방빼기(방공제) 적용 여부 — 켜면 물건 소재지 기준 최우선변제금액을
   * 대출한도에서 차감한다(사용자 요청, 2026-08-05). */
  @Column({ type: "boolean", default: false })
  roomDeductionEnabled!: boolean;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;
}
