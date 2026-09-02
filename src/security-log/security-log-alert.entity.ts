import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("security_log_alerts")
@Index(["fingerprint", "createdAt"])
export class SecurityLogAlert {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  fingerprint!: string;

  @Column()
  ip!: string;

  @Column()
  ruleCode!: string;

  @Column()
  severity!: string;

  @Column({ type: "text" })
  summary!: string;

  @Column({ default: "rules" })
  source!: string;

  @Column({ default: false })
  telegramSent!: boolean;

  @Column({ default: false })
  suppressed!: boolean;

  @Column({ type: "integer", default: 0 })
  requestCount!: number;

  @Column({ type: "text", default: "[]" })
  pathsJson!: string;

  @CreateDateColumn()
  createdAt!: Date;
}

