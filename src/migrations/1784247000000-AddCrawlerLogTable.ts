import { MigrationInterface, QueryRunner } from "typeorm";

/** 매일 작업(스케줄러) 실행 로그를 DB에 영속화 — 기존 인메모리 로그는
 * Railway 재배포/재시작마다 초기화되어 "며칠 전 매일 작업이 잘 돌았는지"
 * 확인이 불가능했다(사용자 지적, 2026-07-25). */
export class AddCrawlerLogTable1784247000000 implements MigrationInterface {
  name = "AddCrawlerLogTable1784247000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawler_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "at" TIMESTAMP NOT NULL DEFAULT now(),
        "level" character varying(10) NOT NULL,
        "message" text NOT NULL,
        "scheduler" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_crawler_log_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_crawler_log_at" ON "crawler_log" ("at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_crawler_log_scheduler" ON "crawler_log" ("scheduler")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crawler_log"`);
  }
}
