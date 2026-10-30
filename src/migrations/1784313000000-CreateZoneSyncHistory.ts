import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 구역 업데이트 실행 기록·변경 이력 누적 테이블 — 사용자 요청, 2026-10-30. */
export class CreateZoneSyncHistory1784313000000 implements MigrationInterface {
  name = "CreateZoneSyncHistory1784313000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "redevelopment_zone_sync_runs" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "startedAt" timestamptz NOT NULL,
      "finishedAt" timestamptz,
      "state" varchar NOT NULL DEFAULT 'running',
      "codes" text NOT NULL,
      "results" text NOT NULL,
      "blocked" text,
      "newCount" integer NOT NULL DEFAULT 0,
      "stageCount" integer NOT NULL DEFAULT 0,
      "typeCount" integer NOT NULL DEFAULT 0,
      "missingCount" integer NOT NULL DEFAULT 0,
      "restoredCount" integer NOT NULL DEFAULT 0
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_zone_sync_runs_startedAt" ON "redevelopment_zone_sync_runs" ("startedAt")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "redevelopment_zone_changes" (
      "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      "runId" varchar NOT NULL,
      "changedAt" timestamptz NOT NULL,
      "zoneKey" varchar NOT NULL,
      "zoneName" varchar NOT NULL DEFAULT '',
      "region" varchar NOT NULL DEFAULT '',
      "changeType" varchar NOT NULL,
      "fromValue" text,
      "toValue" text
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_zone_changes_runId" ON "redevelopment_zone_changes" ("runId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_zone_changes_changedAt" ON "redevelopment_zone_changes" ("changedAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_zone_changes_zoneKey" ON "redevelopment_zone_changes" ("zoneKey")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_zone_changes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_zone_sync_runs"`);
  }
}
