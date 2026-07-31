import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export type KakaoScheduledDispatchStatus = "scheduled" | "sent" | "canceled" | "failed";
export type KakaoScheduledDispatchKind = "bulk" | "test";

/**
 * 선택 발송/테스트 발송을 즉시 보내지 않고 지정 시각에 보내기 위한 예약건.
 * 일괄건 단위로 leadIds를 통째로 저장하며, always-on 틱(스케줄러 ON/OFF와
 * 무관)이 scheduledAt이 지난 "scheduled" 건을 찾아 실제 발송을 수행한다.
 */
@Entity("kakao_scheduled_dispatches")
export class KakaoScheduledDispatch {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text", default: "bulk" })
  kind!: KakaoScheduledDispatchKind;

  /** bulk: 대상 리드 id 목록(JSON 배열). test: 빈 배열. */
  @Column({ type: "text", default: "[]" })
  leadIdsJson!: string;

  /** test 전용: 수신 전화번호 */
  @Column({ type: "text", default: "" })
  testPhone!: string;

  /** test 전용: 표시용 이름 */
  @Column({ type: "text", default: "" })
  testName!: string;

  /** 발송 채널. "sms"면 templateCode/templateName은 비워두고 smsText를 사용한다. */
  @Column({ type: "text", default: "alimtalk" })
  channel!: "alimtalk" | "sms";

  @Column({ type: "text", default: "" })
  templateCode!: string;

  @Column({ type: "text", default: "" })
  templateName!: string;

  /** channel이 sms일 때 사용할 본문 템플릿("#{변수명}" 자리표시자 포함) */
  @Column({ type: "text", default: "" })
  smsText!: string;

  @Column({ type: "text", default: "{}" })
  variablesJson!: string;

  @Column({ type: "text", default: "회원명" })
  templateNameVar!: string;

  @Index()
  @Column({ type: Date })
  scheduledAt!: Date;

  @Index()
  @Column({ type: "text", default: "scheduled" })
  status!: KakaoScheduledDispatchStatus;

  @Column({ type: "integer", default: 0 })
  targetCount!: number;

  @Column({ type: "integer", nullable: true })
  successCount!: number | null;

  @Column({ type: "integer", nullable: true })
  failedCount!: number | null;

  @Column({ type: "text", nullable: true })
  errorMessage!: string | null;

  @Column({ type: "text" })
  createdByAdmin!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ type: Date, nullable: true })
  processedAt!: Date | null;
}
