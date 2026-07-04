import { MigrationInterface, QueryRunner } from "typeorm";

export class AddNaverPriceFloor1751900000000 implements MigrationInterface {
  name = "AddNaverPriceFloor1751900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "naverPriceFloor" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP COLUMN IF EXISTS "naverPriceFloor"`,
    );
  }
}
