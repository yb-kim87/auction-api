import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLeadUtmContent1752900000000 implements MigrationInterface {
  name = "AddKakaoLeadUtmContent1752900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "utmContent" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "utmContent"`);
  }
}
