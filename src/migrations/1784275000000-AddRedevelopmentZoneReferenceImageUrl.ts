import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRedevelopmentZoneReferenceImageUrl1784275000000 implements MigrationInterface {
  name = "AddRedevelopmentZoneReferenceImageUrl1784275000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "referenceImageUrl" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "referenceImageUrl"`);
  }
}
