import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoLeadExclusionAndAdCreatives1752500000000
  implements MigrationInterface
{
  name = "AddKakaoLeadExclusionAndAdCreatives1752500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD COLUMN IF NOT EXISTS "excludedFromBulk" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_excluded_from_bulk" ON "kakao_leads" ("excludedFromBulk")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_ad_creatives" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "adName" character varying NOT NULL,
        "mediaUrl" character varying NOT NULL,
        "mediaType" character varying NOT NULL DEFAULT 'image',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kakao_ad_creatives_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kakao_ad_creatives_ad_name" UNIQUE ("adName")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_ad_creatives"`);
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" DROP COLUMN IF EXISTS "excludedFromBulk"`,
    );
  }
}
