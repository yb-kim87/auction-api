import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";
import { UserRole } from "../common/constants";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  username!: string;

  @Column()
  password!: string;

  @Column({ default: "" })
  name!: string;

  @Column({ type: "text", default: "" })
  phone!: string;

  @Column({ type: "text", default: UserRole.MEMBER })
  role!: UserRole;

  @Column({ type: "text", default: "" })
  investableFunds!: string;

  @Column({ type: "text", default: "" })
  existingLoanAmount!: string;

  @Column({ type: "integer", default: 0 })
  housingCount!: number;

  @Column({ type: "text", default: "" })
  creditScore!: string;

  @Column({ type: "text", default: "" })
  annualNetIncome!: string;

  @Column({ type: "text", default: "" })
  investmentGoal!: string;

  @Column({ type: "text", default: "" })
  targetReturn!: string;

  @Column({ type: "boolean", default: false })
  firstTimeBuyer!: boolean;

  @Column({ type: "integer", default: 10 })
  aiAnalysisLimit!: number;

  @Column({ type: "integer", default: 0 })
  aiAnalysisUsed!: number;

  @CreateDateColumn()
  createdAt!: Date;
}
