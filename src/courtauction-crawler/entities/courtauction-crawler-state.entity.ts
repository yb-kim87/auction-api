import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type CourtAuctionCrawlerPhase = "idle" | "importing" | "stopped" | "error";

/** 대법원 법원경매정보 작업창의 진행 상태(단일 행) — 탱크/나이스 작업창과
 * 완전히 별도 테이블(사용자 요청, 2026-09-03). */
@Entity("courtauction_crawler_state")
export class CourtAuctionCrawlerStateRow {
  @PrimaryColumn({ default: "singleton" })
  id!: string;

  @Column({ type: "boolean", default: false })
  running!: boolean;

  @Column({ type: "text", default: "idle" })
  phase!: CourtAuctionCrawlerPhase;

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

  /** 작업목록 스테이징 — "수집"으로 만든 CourtAuctionUrlEntry[] JSON.
   * 나이스와 달리 목록 API 단계에서 이미 raw 전체 필드를 담아두므로,
   * "조회 시작" 단계에서 추가 사이트 요청이 필요 없다. */
  @Column({ type: "text", nullable: true })
  urls!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
