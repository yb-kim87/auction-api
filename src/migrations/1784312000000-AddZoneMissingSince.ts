import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발 구역 — 재개발닷컴 수집에서 사라진 구역 표시용 시각(구역은 삭제하지 않음) — 사용자 요청, 2026-10-30. */
export class AddZoneMissingSince1784312000000 implements MigrationInterface {
  name = "AddZoneMissingSince1784312000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "missingSince" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "missingSince"`);
  }
}
