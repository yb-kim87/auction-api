import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 구역 자동 업데이트 설정 + 실행 기록에 실행 주체(수동/자동) 추가 — 사용자 요청, 2026-10-30. */
export class CreateZoneAutoSync1784314000000 implements MigrationInterface {
  name = "CreateZoneAutoSync1784314000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "redevelopment_zone_auto_sync" (
      "id" varchar PRIMARY KEY,
      "enabled" boolean NOT NULL DEFAULT false,
      "intervalDays" integer NOT NULL DEFAULT 14,
      "codes" text NOT NULL DEFAULT '[]',
      "lastRunAt" timestamptz,
      "nextRunAt" timestamptz,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_sync_runs" ADD COLUMN IF NOT EXISTS "triggeredBy" varchar NOT NULL DEFAULT 'manual'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_sync_runs" DROP COLUMN IF EXISTS "triggeredBy"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_zone_auto_sync"`);
  }
}
