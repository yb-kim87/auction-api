import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

/** 매일 작업(스케줄러) 실행 로그를 DB에 영속화한다. 기존엔 서비스
 * 인스턴스의 인메모리 배열(this.logs)에만 쌓아 Railway 재배포·재시작마다
 * 전부 사라졌다 — "며칠 전 매일 작업이 잘 돌았는지" 확인할 방법이 없다는
 * 문제(사용자 지적, 2026-07-25). CrawlerConfigRow와 동일한 이유로 DB 저장이
 * 필요하다. */
@Entity("crawler_log")
export class CrawlerLogRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @CreateDateColumn()
  @Index()
  at!: Date;

  @Column({ type: "varchar", length: 10 })
  level!: "info" | "warn" | "error";

  @Column({ type: "text" })
  message!: string;

  @Column({ type: "boolean", default: false })
  @Index()
  scheduler!: boolean;
}
