import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLeadGroupLabel1752600000000 implements MigrationInterface {
  name = "AddKakaoLeadGroupLabel1752600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "groupLabel" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_group_label" ON "kakao_leads" ("groupLabel")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "groupLabel"`);
  }
}
