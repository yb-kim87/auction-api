import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import type { ZoneChangeType } from "./redevelopment-zone-sync-run.entity";

/** 재개발닷컴 구역 업데이트로 바뀐 내용 한 건(신규·단계 변경·사업유형 변경·사라짐·복구·주요 지표 변경)을 누적한다. 삭제하지 않는다. */
@Entity("redevelopment_zone_changes")
export class RedevelopmentZoneChange {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 어느 업데이트 실행(redevelopment_zone_sync_runs.id)에서 생긴 변경인지. */
  @Index()
  @Column({ type: "varchar" })
  runId!: string;

  @Index()
  @Column({ type: Date })
  changedAt!: Date;

  /** 구역 식별 키(예: jaegebal-4296, 하위 폴리곤은 jaegebal-4296-2) — 구역별 이력 조회용. */
  @Index()
  @Column({ type: "varchar" })
  zoneKey!: string;

  @Column({ type: "varchar", default: "" })
  zoneName!: string;

  /** 구(예: 영등포구). */
  @Column({ type: "varchar", default: "" })
  region!: string;

  @Column({ type: "varchar" })
  changeType!: ZoneChangeType;

  /** 변경 전 값(단계·사업유형, 지표는 "세대수 1,162 · 시공사 -" 같은 요약). 신규·복구는 null. */
  @Column({ type: "text", nullable: true })
  fromValue!: string | null;

  /** 변경 후 값. 사라짐·복구는 null일 수 있다. */
  @Column({ type: "text", nullable: true })
  toValue!: string | null;
}
