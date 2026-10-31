import { MigrationInterface, QueryRunner } from "typeorm";

/** 구역 업데이트 실행 기록 — 주요 지표 변경 구역 수 — 사용자 요청, 2026-10-30. */
export class AddZoneStatsCount1784317000000 implements MigrationInterface {
  name = "AddZoneStatsCount1784317000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_sync_runs" ADD COLUMN IF NOT EXISTS "statsCount" integer NOT NULL DEFAULT 0`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_sync_runs" DROP COLUMN IF EXISTS "statsCount"`);
  }
}
