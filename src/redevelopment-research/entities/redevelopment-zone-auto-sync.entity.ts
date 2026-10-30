import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 재개발닷컴 구역 자동 업데이트 설정(단일 행, id="jaegebal") — 켜면 지정한 구를 주기마다 새벽에 서버가 자동으로 업데이트한다.
 * 기본은 꺼짐·14일(사용자 요청, 2026-10-30). "선택한 구 지금 업데이트"와는 별개로 동작한다. */
@Entity("redevelopment_zone_auto_sync")
export class RedevelopmentZoneAutoSync {
  @PrimaryColumn({ type: "varchar" })
  id!: string;

  @Column({ type: Boolean, default: false })
  enabled!: boolean;

  /** 업데이트 주기(일). 기본 14. */
  @Column({ type: "integer", default: 14 })
  intervalDays!: number;

  /** 자동으로 업데이트할 구 코드 목록. */
  @Column({ type: "simple-json" })
  codes!: string[];

  /** 마지막으로 자동 업데이트를 시작한 시각. */
  @Column({ type: Date, nullable: true })
  lastRunAt!: Date | null;

  /** 다음 자동 업데이트 예정 시각(이 시각이 지나고 한국시간 새벽 1~5시 사이에 실행). */
  @Column({ type: Date, nullable: true })
  nextRunAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
