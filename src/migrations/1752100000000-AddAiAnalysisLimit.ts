import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiAnalysisLimit1752100000000 implements MigrationInterface {
  name = "AddAiAnalysisLimit1752100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aiAnalysisLimit" integer NOT NULL DEFAULT 10`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "aiAnalysisUsed" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "aiAnalysisUsed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "aiAnalysisLimit"`,
    );
  }
}
