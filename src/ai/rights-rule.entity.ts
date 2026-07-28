import {
  Column,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("rights_analysis_rules")
export class RightsAnalysisRule {
  @PrimaryColumn({ type: "text" })
  code!: string;

  @Column({ type: "text" })
  value!: string;

  @Column({ type: "text", default: "" })
  updatedBy!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
