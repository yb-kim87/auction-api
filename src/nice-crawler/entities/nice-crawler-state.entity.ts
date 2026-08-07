import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type NiceCrawlerPhase =
  | "idle"
  | "collecting_objids"
  | "matching"
  | "fetching_details"
  | "stopped"
  | "error";

/** 나이스옥션 작업창의 진행 상태(단일 행). 관리자 브라우저가 폴링해서
 * 보여주고, 로컬 워커(crawler/nice_worker.py)가 폴링해서 실행 여부를
 * 판단한다 — 탱크옥션 작업창(crawler_config/crawler.service.ts의
 * localStatus)과 같은 패턴이지만 완전히 별도 테이블이다. */
@Entity("nice_crawler_state")
export class NiceCrawlerStateRow {
  @PrimaryColumn({ default: "singleton" })
  id!: string;

  @Column({ type: "boolean", default: false })
  running!: boolean;

  @Column({ type: "text", default: "idle" })
  phase!: NiceCrawlerPhase;

  /** 워커가 확보한 objId 큐 크기(사이트맵 수집 결과). */
  @Column({ type: "integer", default: 0 })
  totalObjIds!: number;

  /** 우리 DB와 매칭돼 실제로 가져올 대상으로 확정된 건수. */
  @Column({ type: "integer", default: 0 })
  matched!: number;

  @Column({ type: "integer", default: 0 })
  completed!: number;

  @Column({ type: "integer", default: 0 })
  created!: number;

  @Column({ type: "integer", default: 0 })
  updated!: number;

  @Column({ type: "integer", default: 0 })
  skipped!: number;

  @Column({ type: "text", nullable: true })
  lastMessage!: string | null;

  @Column({ type: "text", nullable: true })
  error!: string | null;

  /** 관리자가 "시작"을 누를 때 넘긴 NiceSearchConfig JSON — 로컬 워커가
   * 폴링해서 이 조건으로 나이스 검색 API를 호출한다. */
  @Column({ type: "text", nullable: true })
  searchConfig!: string | null;

  /** 워커가 마지막으로 상태를 보고한 시각 — 이게 너무 오래됐으면
   * running=true여도 워커가 죽었다고 판단할 수 있다(탱크옥션의
   * remoteWorker 하트비트 개념과 동일). */
  @UpdateDateColumn()
  updatedAt!: Date;
}
