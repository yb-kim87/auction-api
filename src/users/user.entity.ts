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

  @Column({ type: "text", default: UserRole.MEMBER })
  role!: UserRole;

  @Column({ type: "text", default: "" })
  investableFunds!: string;

  @Column({ type: "text", default: "" })
  existingLoanAmount!: string;

  @Column({ type: "integer", default: 0 })
  housingCount!: number;

  @Column({ type: "text", default: "" })
  investmentGoal!: string;

  @Column({ type: "text", default: "" })
  targetReturn!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
