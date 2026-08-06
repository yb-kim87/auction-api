import { MigrationInterface, QueryRunner } from "typeorm";

/** 나이스옥션 작업창(탱크옥션 작업창과 완전히 독립된 병렬 시스템) 상태/로그
 * 테이블(사용자 요청, 2026-08-07). */
export class CreateNiceCrawlerTables1784283000000 implements MigrationInterface {
  name = "CreateNiceCrawlerTables1784283000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "nice_crawler_state" (
        "id" text NOT NULL DEFAULT 'singleton',
        "running" boolean NOT NULL DEFAULT false,
        "phase" text NOT NULL DEFAULT 'idle',
        "totalObjIds" integer NOT NULL DEFAULT 0,
        "matched" integer NOT NULL DEFAULT 0,
        "completed" integer NOT NULL DEFAULT 0,
        "created" integer NOT NULL DEFAULT 0,
        "updated" integer NOT NULL DEFAULT 0,
        "skipped" integer NOT NULL DEFAULT 0,
        "lastMessage" text,
        "error" text,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_nice_crawler_state" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "nice_crawler_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "at" TIMESTAMP NOT NULL DEFAULT now(),
        "level" varchar(10) NOT NULL,
        "message" text NOT NULL,
        CONSTRAINT "PK_nice_crawler_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_nice_crawler_log_at" ON "nice_crawler_log" ("at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "nice_crawler_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "nice_crawler_state"`);
  }
}
