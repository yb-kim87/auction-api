import { Entity, PrimaryColumn, Column } from "typeorm";

export type KakaoSyncSource = "imweb" | "instagram" | "manual_sheet" | "scheduler";
export type KakaoSyncRunStatus = "ok" | "error" | "never_run";

@Entity("kakao_sync_state")
export class KakaoSyncState {
  @PrimaryColumn({ type: "text" })
  source!: KakaoSyncSource;

  @Column({ type: Date, nullable: true })
  lastSyncedAt!: Date | null;

  @Column({ type: "text", nullable: true })
  lastCursor!: string | null;

  @Column({ type: Date, nullable: true })
  lastRunAt!: Date | null;

  @Column({ type: "text", default: "never_run" })
  lastRunStatus!: KakaoSyncRunStatus;

  @Column({ type: "text", nullable: true })
  lastErrorMessage!: string | null;

  /** 소스별 관리자 설정(JSON). 인스타(구글시트)의 spreadsheetId/range 등을 저장. */
  @Column({ type: "text", default: "{}" })
  configJson!: string;
}
