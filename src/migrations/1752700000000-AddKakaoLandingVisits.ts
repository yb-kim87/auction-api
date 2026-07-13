import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLandingVisits1752700000000 implements MigrationInterface {
  name = "AddKakaoLandingVisits1752700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_landing_visits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "visitId" text NOT NULL,
        "utmSource" text NOT NULL DEFAULT '',
        "utmMedium" text NOT NULL DEFAULT '',
        "utmCampaign" text NOT NULL DEFAULT '',
        "utmContent" text NOT NULL DEFAULT '',
        "fbclid" text NOT NULL DEFAULT '',
        "landingUrl" text NOT NULL DEFAULT '',
        "referrer" text NOT NULL DEFAULT '',
        "visitedAt" TIMESTAMP NOT NULL,
        "signupConfirmedAt" TIMESTAMP,
        "matched" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kakao_landing_visits_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kakao_landing_visits_visit_id" UNIQUE ("visitId")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_landing_visits_visited_at" ON "kakao_landing_visits" ("visitedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_landing_visits_signup_confirmed_at" ON "kakao_landing_visits" ("signupConfirmedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_landing_visits_matched" ON "kakao_landing_visits" ("matched")`,
    );

    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "utmSource" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "utmCampaign" text NOT NULL DEFAULT ''`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "utmMedium" text NOT NULL DEFAULT ''`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "utmMedium"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "utmCampaign"`);
    await queryRunner.query(`ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "utmSource"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_landing_visits"`);
  }
}
