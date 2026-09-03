import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 대법원 법원경매정보 작업창 로그 — 탱크/나이스 전용 로그 테이블을
 * 건드리지 않고 별도 테이블을 쓴다(동일 패턴). */
@Entity("courtauction_crawler_log")
export class CourtAuctionCrawlerLogRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn()
  @Index()
  at!: Date;

  @Column({ type: "varchar", length: 10 })
  level!: "info" | "warn" | "error";

  @Column({ type: "text" })
  message!: string;
}
