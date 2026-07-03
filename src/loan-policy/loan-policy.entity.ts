import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity("loan_policies")
export class LoanPolicy {
  @PrimaryColumn()
  id!: string;

  @Column()
  label!: string;

  @Column({ type: "real" })
  loanRatio!: number;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;
}
