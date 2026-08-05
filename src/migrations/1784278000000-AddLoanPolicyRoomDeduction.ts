import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddLoanPolicyRoomDeduction1784278000000 implements MigrationInterface {
  name = "AddLoanPolicyRoomDeduction1784278000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "roomDeductionEnabled" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "roomDeductionEnabled"`);
  }
}
