import { MigrationInterface, QueryRunner } from "typeorm";

export class AddActualTradeLandArea1784268000000 implements MigrationInterface {
  name = "AddActualTradeLandArea1784268000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_trade" ADD COLUMN IF NOT EXISTS "landArea" numeric(8,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "actual_trade" DROP COLUMN IF EXISTS "landArea"`,
    );
  }
}
