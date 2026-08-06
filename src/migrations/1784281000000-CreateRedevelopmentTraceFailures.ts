import { MigrationInterface, QueryRunner } from "typeorm";

/** 구역도 경계 자동 추출 실패 로그 테이블(사용자 요청, 2026-08-06). */
export class CreateRedevelopmentTraceFailures1784281000000 implements MigrationInterface {
  name = "CreateRedevelopmentTraceFailures1784281000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_trace_failures" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zoneId" text,
        "zoneName" text NOT NULL DEFAULT '',
        "imageUrl" text NOT NULL DEFAULT '',
        "imageWidth" integer NOT NULL DEFAULT 0,
        "imageHeight" integer NOT NULL DEFAULT 0,
        "reason" text NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "detail" text,
        "occurrences" integer NOT NULL DEFAULT 1,
        "resolvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "lastSeenAt" TIMESTAMP,
        CONSTRAINT "PK_redevelopment_trace_failures" PRIMARY KEY ("id")
      )
    `);
    // 같은 이미지의 반복 실패는 새 행을 쌓지 않고 occurrences만 올린다.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_trace_failure_image"
      ON "redevelopment_trace_failures" ("imageUrl")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_trace_failure_image"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_trace_failures"`);
  }
}
