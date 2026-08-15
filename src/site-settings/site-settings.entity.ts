import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 사이트 전역 설정(단일 행) — 관리자가 관리자 페이지에서 켜고 끄는
 * 토글류 설정을 모아둔다(사용자 요청, 2026-08-08: "해당 부분을 토글
 * 버튼으로 조정할 수 있게 관리자 페이지에도 만들어줘"). 설정이 늘어날
 * 때마다 컬럼을 추가한다 — nice_crawler_state 등 기존 싱글톤 행 패턴과
 * 동일. */
@Entity("app_settings")
export class AppSettingsRow {
  @PrimaryColumn({ default: "singleton" })
  id!: string;

  /** true면 물건 상세의 "등기·임차인 정보" 섹션을 수강생 이하 등급
   * (student/member/ot_student)에게 숨긴다. 기존에 하드코딩돼 있던
   * 기본 동작을 그대로 유지하기 위해 기본값은 true. */
  @Column({ type: "boolean", default: true })
  hideRegistryTenantForStudents!: boolean;

  // 과제 알림톡(사용자 요청, 2026-08-15) — 기본은 꺼짐. 켜면 (1) 과제가
  // 새로 제출될 때 코치 폰번호로, (2) 코치 피드백이 등록될 때 그 과제를
  // 제출한 수강생 폰번호로 알림을 보낸다. 발신은 기존 솔라피(경매코치)
  // 계정을 그대로 쓰고, 알림톡 템플릿 코드를 비워두면(초기 상태) 승인
  // 절차가 필요 없는 문자(SMS)로 대체 발송한다 — 나중에 알림톡 템플릿이
  // 승인되면 코드만 채워 넣어 알림톡으로 전환할 수 있다.
  @Column({ type: "boolean", default: false })
  assignmentNotifyEnabled!: boolean;

  @Column({ type: "text", default: "" })
  assignmentNotifyCoachPhone!: string;

  @Column({ type: "text", default: "" })
  assignmentCreatedTemplateCode!: string;

  @Column({ type: "text", default: "" })
  coachFeedbackTemplateCode!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
