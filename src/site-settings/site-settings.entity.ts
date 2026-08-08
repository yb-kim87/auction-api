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

  @UpdateDateColumn()
  updatedAt!: Date;
}
