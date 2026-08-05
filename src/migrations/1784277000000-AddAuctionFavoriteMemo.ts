import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionFavoriteMemo1784277000000 implements MigrationInterface {
  name = "AddAuctionFavoriteMemo1784277000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auction_favorites" ADD COLUMN IF NOT EXISTS "memo" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auction_favorites" DROP COLUMN IF EXISTS "memo"`);
  }
}
