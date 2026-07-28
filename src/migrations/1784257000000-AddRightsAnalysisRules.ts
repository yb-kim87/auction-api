import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddRightsAnalysisRules1784257000000 implements MigrationInterface {
  name = "AddRightsAnalysisRules1784257000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rights_analysis_rules" (
        "code" text PRIMARY KEY,
        "value" text NOT NULL,
        "updatedBy" text NOT NULL DEFAULT '',
        "updatedAt" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "rights_analysis_rules"`);
  }
}
