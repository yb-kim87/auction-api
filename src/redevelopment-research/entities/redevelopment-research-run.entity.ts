import { Column, Entity, PrimaryColumn } from "typeorm";

export type ResearchRunStatus = "idle" | "running" | "done" | "error" | "interrupted";

/** 구역 1개당 조사(네이버 매물 + 국토부 실거래) 진행 상태. 백그라운드로 도는 작업의 진행도를 DB에
 * 남겨 재배포로 프로세스가 죽어도 상태를 알 수 있게 한다(samsam 백필 상태 조회와 같은 이유). */
@Entity("redevelopment_research_runs")
export class RedevelopmentResearchRun {
  @PrimaryColumn({ type: "varchar" })
  zoneId!: string;

  @Column({ type: "text", default: "idle" })
  status!: ResearchRunStatus;

  /** 현재 단계 표시용(예: "실거래 수집", "네이버 매물 목록", "네이버 상세 3/40"). */
  @Column({ type: "text", default: "" })
  phase!: string;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  @Column({ type: "int", default: 0 })
  naverFetched!: number;

  @Column({ type: "int", default: 0 })
  naverSaved!: number;

  @Column({ type: "int", default: 0 })
  naverDetailDone!: number;

  /** 아직 상세를 못 가져온 매물 수 — 0보다 크면 "이어서 수집"을 눌러야 한다. */
  @Column({ type: "int", default: 0 })
  naverDetailRemaining!: number;

  @Column({ type: "int", default: 0 })
  tradesFetched!: number;

  @Column({ type: "int", default: 0 })
  tradesSaved!: number;

  @Column({ type: Date, nullable: true })
  startedAt!: Date | null;

  @Column({ type: Date, nullable: true })
  finishedAt!: Date | null;

  /** 재개발 블로그(후니동산) 조사를 마친 시각 — 구역 조사 때 함께 갱신한다. */
  @Column({ type: Date, nullable: true })
  blogFetchedAt!: Date | null;

  @Column({ type: Date })
  updatedAt!: Date;
}
