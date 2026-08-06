import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 나이스옥션 작업창(탱크옥션 작업창과 완전히 독립된 병렬 시스템) 로그.
 * 기존 crawler_log(탱크 전용)를 건드리지 않고 별도 테이블을 쓴다
 * (사용자 요청, 2026-08-07: "기존 탱크옥션 작업창을 그대로 두고 나이스
 * 작업창을 하나 만들어서"). */
@Entity("nice_crawler_log")
export class NiceCrawlerLogRow {
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
