import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type KakaoDispatchResult = "success" | "failed";
export type KakaoDispatchTrigger = "auto" | "manual_retry" | "test" | "bulk_manual";

@Entity("kakao_dispatch_logs")
export class KakaoDispatchLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 테스트 발송은 실제 리드를 만들지 않으므로 nullable */
  @Index()
  @Column({ type: "text", nullable: true })
  leadId!: string | null;

  @Column({ type: "integer", default: 1 })
  attemptNo!: number;

  @Column({ type: "text", default: "" })
  templateCode!: string;

  @Column({ type: "text", default: "" })
  requestPayload!: string;

  @Column({ type: "text", default: "" })
  responsePayload!: string;

  @Index()
  @Column({ type: "text" })
  result!: KakaoDispatchResult;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @Column({ type: "text", default: "auto" })
  triggeredBy!: KakaoDispatchTrigger;

  @Column({ type: "text", nullable: true })
  triggeredByAdmin!: string | null;

  @CreateDateColumn()
  sentAt!: Date;
}
