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

  /** 계정당 동시 로그인 1개 제한(수강생 대상)에 쓰는 현재 세션 식별자(로그인 시 발급). */
  @Column({ type: "text", nullable: true })
  currentSessionId!: string | null;

  /** 위 세션의 마지막 활동 시각. 일정 시간(유휴 타임아웃) 갱신이 없으면 자리를 비운 것으로 보고 새 로그인을 허용한다. */
  @Column({ type: Date, nullable: true })
  sessionLastActiveAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
