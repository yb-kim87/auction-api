import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLeadSurveyFields1784220000000 implements MigrationInterface {
  name = "AddKakaoLeadSurveyFields1784220000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kakao_leads"
      ADD COLUMN IF NOT EXISTS "surveyAnswers" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "surveyAnswers"`);
  }
}
