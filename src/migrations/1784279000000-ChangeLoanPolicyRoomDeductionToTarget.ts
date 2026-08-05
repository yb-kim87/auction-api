import type { MigrationInterface, QueryRunner } from "typeorm";

export class ChangeLoanPolicyRoomDeductionToTarget1784279000000 implements MigrationInterface {
  name = "ChangeLoanPolicyRoomDeductionToTarget1784279000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "roomDeductionTarget" text NOT NULL DEFAULT 'none'
    `);
    // 이전 체크박스(roomDeductionEnabled=true)를 켰던 정책은 "둘 다 적용"으로
    // 이관해 기존 동작(감정가·낙찰가 모두 반영)을 최대한 보존한다.
    await queryRunner.query(`
      UPDATE "loan_policies" SET "roomDeductionTarget" = 'both' WHERE "roomDeductionEnabled" = true
    `);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "roomDeductionEnabled"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "roomDeductionEnabled" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      UPDATE "loan_policies" SET "roomDeductionEnabled" = true WHERE "roomDeductionTarget" <> 'none'
    `);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "roomDeductionTarget"`);
  }
}
