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

  @CreateDateColumn()
  createdAt!: Date;
}
