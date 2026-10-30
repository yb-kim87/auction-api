import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type ZoneChangeType = "new" | "stage" | "projectType" | "missing" | "restored";

/** 재개발닷컴 구역 업데이트 1회 실행 기록 — 구역이 하나도 안 바뀐 실행도 남긴다(사용자 요청, 2026-10-30: 구역 업데이트 이력을 날짜별로 조회). */
@Entity("redevelopment_zone_sync_runs")
export class RedevelopmentZoneSyncRun {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: Date })
  startedAt!: Date;

  @Column({ type: Date, nullable: true })
  finishedAt!: Date | null;

  /** running | done | blocked(사이트 보안 확인으로 중단) | failed */
  @Column({ type: "varchar", default: "running" })
  state!: string;

  /** 실행 주체: manual(관리자가 지금 실행) | auto(자동 업데이트 설정에 따라 서버가 실행). */
  @Column({ type: "varchar", default: "manual" })
  triggeredBy!: string;

  /** 요청한 구 코드. */
  @Column({ type: "simple-json" })
  codes!: string[];

  /** 구별 결과(가져온 건수·신규·변경·사라짐·복구·경고·오류). */
  @Column({ type: "simple-json" })
  results!: unknown[];

  /** 보안 확인에 걸려 중단된 경우 그 사유. */
  @Column({ type: "text", nullable: true })
  blocked!: string | null;

  @Column({ type: "integer", default: 0 }) newCount!: number;
  @Column({ type: "integer", default: 0 }) stageCount!: number;
  @Column({ type: "integer", default: 0 }) typeCount!: number;
  @Column({ type: "integer", default: 0 }) missingCount!: number;
  @Column({ type: "integer", default: 0 }) restoredCount!: number;
}
