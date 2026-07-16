import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionExtraData1784210075780 implements MigrationInterface {
  name = "AddAuctionExtraData1784210075780";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "extraData" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "extraData"`);
  }
}
