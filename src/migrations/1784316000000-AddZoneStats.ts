import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발 구역 — 재개발닷컴 구역 지표(세대수·노후도 등) 저장 컬럼 — 사용자 요청, 2026-10-30. */
export class AddZoneStats1784316000000 implements MigrationInterface {
  name = "AddZoneStats1784316000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "stats" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "stats"`);
  }
}
