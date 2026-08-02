import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLectureReplay1784262000000 implements MigrationInterface {
  name = "CreateLectureReplay1784262000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "title" text NOT NULL,
        "description" text,
        "isPublished" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "course_sections" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "courseId" uuid NOT NULL,
        "title" text NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_course_sections_courseId" ON "course_sections" ("courseId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "course_videos" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "sectionId" uuid NOT NULL,
        "title" text NOT NULL,
        "description" text,
        "bunnyVideoId" text NOT NULL,
        "durationSeconds" integer,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "isPublished" boolean NOT NULL DEFAULT false,
        "createdAt" timestamptz NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_course_videos_sectionId" ON "course_videos" ("sectionId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecture_access_links" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "token" text NOT NULL,
        "courseId" uuid NOT NULL,
        "title" text NOT NULL,
        "expiresAt" timestamptz,
        "isActive" boolean NOT NULL DEFAULT true,
        "createdAt" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_lecture_access_links_token" UNIQUE ("token")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lecture_access_links_courseId" ON "lecture_access_links" ("courseId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_access_links"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_videos"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "course_sections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courses"`);
  }
}
