import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoAdCreativeLabel1752900100000 implements MigrationInterface {
  name = "AddKakaoAdCreativeLabel1752900100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kakao_ad_creatives" ADD COLUMN IF NOT EXISTS "label" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_ad_creatives" DROP COLUMN IF EXISTS "label"`);
  }
}
