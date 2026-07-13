import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoRoomClickTracking1752800000000 implements MigrationInterface {
  name = "AddKakaoRoomClickTracking1752800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "kakao_landing_visits" ADD COLUMN IF NOT EXISTS "kakaoRoomClickedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "kakaoRoomClickedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "visitId" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_visit_id" ON "kakao_leads" ("visitId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "visitId"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "kakaoRoomClickedAt"`);
    await queryRunner.query(
      `ALTER TABLE "kakao_landing_visits" DROP COLUMN IF EXISTS "kakaoRoomClickedAt"`,
    );
  }
}
