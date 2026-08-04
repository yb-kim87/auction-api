import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRedevelopmentZoneSourceFields1784274000000 implements MigrationInterface {
  name = "AddRedevelopmentZoneSourceFields1784274000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "projectType" text
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "source" text NOT NULL DEFAULT 'MANUAL'
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "sourceDatasetId" text
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "sourceKey" text
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "asOfDate" date
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "boundaryType" text NOT NULL DEFAULT 'MANUAL'
    `);
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "lastAutoSyncedAt" timestamp
    `);
    // 같은 소스+데이터셋+원본키 조합의 중복 생성을 막는다(설계 §6.1).
    // source/sourceDatasetId/sourceKey가 전부 null인 기존 MANUAL 구역들은
    // Postgres에서 NULL끼리는 유니크 제약에 걸리지 않아 그대로 공존 가능.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_redevelopment_zones_source_key"
      ON "redevelopment_zones" ("source", "sourceDatasetId", "sourceKey")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_redevelopment_zones_source_key"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "lastAutoSyncedAt"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "boundaryType"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "asOfDate"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "sourceKey"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "sourceDatasetId"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "projectType"`);
  }
}
