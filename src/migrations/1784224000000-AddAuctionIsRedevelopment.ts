import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionIsRedevelopment1784224000000 implements MigrationInterface {
  name = "AddAuctionIsRedevelopment1784224000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "isRedevelopment" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "isRedevelopment"`);
  }
}
