import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionLatLng1784270000000 implements MigrationInterface {
  name = "AddAuctionLatLng1784270000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "latitude" numeric(9,6)
    `);
    await queryRunner.query(`
      ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "longitude" numeric(9,6)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "latitude"`);
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "longitude"`);
  }
}
