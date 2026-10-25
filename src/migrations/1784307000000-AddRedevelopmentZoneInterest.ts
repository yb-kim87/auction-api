import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발 구역별 "관심" 표시(사용자 요청, 2026-10-25). */
export class AddRedevelopmentZoneInterest1784307000000 implements MigrationInterface {
  name = "AddRedevelopmentZoneInterest1784307000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "isInterest" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "isInterest"`);
  }
}
