import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 구역 자동 업데이트 — 실행 시각(한국시간 시·분) 설정 추가(기본 03:00) — 사용자 요청, 2026-10-30. */
export class AddAutoSyncRunTime1784315000000 implements MigrationInterface {
  name = "AddAutoSyncRunTime1784315000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" ADD COLUMN IF NOT EXISTS "runHour" integer NOT NULL DEFAULT 3`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" ADD COLUMN IF NOT EXISTS "runMinute" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" DROP COLUMN IF EXISTS "runMinute"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" DROP COLUMN IF EXISTS "runHour"`);
  }
}
