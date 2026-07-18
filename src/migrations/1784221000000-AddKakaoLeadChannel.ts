import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLeadChannel1784221000000 implements MigrationInterface {
  name = "AddKakaoLeadChannel1784221000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kakao_leads"
      ADD COLUMN IF NOT EXISTS "channel" text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_channel" ON "kakao_leads" ("channel")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kakao_leads_channel"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "channel"`);
  }
}
