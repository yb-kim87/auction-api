import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActualTradeHouseType1784267000000 implements MigrationInterface {
  name = "AddActualTradeHouseType1784267000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_trade" ADD COLUMN IF NOT EXISTS "houseType" text DEFAULT 'APT'`,
    );
    await queryRunner.query(
      `UPDATE "actual_trade" SET "houseType" = 'APT' WHERE "houseType" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_trade" DROP COLUMN IF EXISTS "houseType"`,
    );
  }
}
