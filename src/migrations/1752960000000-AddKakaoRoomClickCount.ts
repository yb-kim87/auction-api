import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoRoomClickCount1752960000000 implements MigrationInterface {
  name = "AddKakaoRoomClickCount1752960000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kakao_leads"
      ADD COLUMN IF NOT EXISTS "firstKakaoRoomClickedAt" TIMESTAMP
    `);
    await queryRunner.query(`
      ALTER TABLE "kakao_leads"
      ADD COLUMN IF NOT EXISTS "kakaoRoomClickCount" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "kakao_leads"
      SET "firstKakaoRoomClickedAt" = "kakaoRoomClickedAt",
          "kakaoRoomClickCount" = 1
      WHERE "kakaoRoomClickedAt" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "kakao_landing_visits"
      ADD COLUMN IF NOT EXISTS "kakaoRoomClickCount" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      UPDATE "kakao_landing_visits"
      SET "kakaoRoomClickCount" = 1
      WHERE "kakaoRoomClickedAt" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_landing_visits" DROP COLUMN IF EXISTS "kakaoRoomClickCount"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "kakaoRoomClickCount"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "firstKakaoRoomClickedAt"`);
  }
}
