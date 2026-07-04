import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNaverPriceFloorLabel1752000000000 implements MigrationInterface {
  name = "AddNaverPriceFloorLabel1752000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "naverPriceFloorLabel" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP COLUMN IF EXISTS "naverPriceFloorLabel"`,
    );
  }
}
