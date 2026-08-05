import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRedevelopmentZoneArea1784280000000 implements MigrationInterface {
  name = "AddRedevelopmentZoneArea1784280000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "areaSqMeters" real
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "areaSqMeters"`);
  }
}
