import { MigrationInterface, QueryRunner } from "typeorm";

/** 구역 조사 시 재개발 블로그에서 찾은 동의율·공문 타임라인 저장 테이블 + 조사 실행 기록에 블로그 조회 시각. */
export class CreateRedevelopmentZoneBlogNotes1784305000000 implements MigrationInterface {
  name = "CreateRedevelopmentZoneBlogNotes1784305000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_zone_blog_notes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zoneId" character varying NOT NULL,
        "blogId" character varying NOT NULL,
        "logNo" character varying NOT NULL,
        "postTitle" text NOT NULL,
        "postedAt" text NOT NULL,
        "url" text NOT NULL,
        "kind" text NOT NULL,
        "text" text NOT NULL,
        "yesPct" double precision NULL,
        "noPct" double precision NULL,
        "qualifier" text NULL,
        "docDate" text NULL,
        "fetchedAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_redev_zone_blog_notes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_redev_blog_note_zone" ON "redevelopment_zone_blog_notes" ("zoneId")`);
    await queryRunner.query(`ALTER TABLE "redevelopment_research_runs" ADD COLUMN IF NOT EXISTS "blogFetchedAt" TIMESTAMP NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_research_runs" DROP COLUMN IF EXISTS "blogFetchedAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_redev_blog_note_zone"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_zone_blog_notes"`);
  }
}
