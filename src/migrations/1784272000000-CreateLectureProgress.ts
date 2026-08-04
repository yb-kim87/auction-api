import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLectureProgress1784272000000 implements MigrationInterface {
  name = "CreateLectureProgress1784272000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecture_progress" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" character varying NOT NULL,
        "courseId" character varying NOT NULL,
        "videoId" character varying NOT NULL,
        "chapterStartSeconds" integer NOT NULL DEFAULT 0,
        "lastPositionSeconds" integer NOT NULL DEFAULT 0,
        "isCompleted" boolean NOT NULL DEFAULT false,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lecture_progress" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_lecture_progress_row" UNIQUE ("username", "courseId", "videoId", "chapterStartSeconds")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_progress_username" ON "lecture_progress" ("username")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_progress_course" ON "lecture_progress" ("courseId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_progress_video" ON "lecture_progress" ("videoId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_progress"`);
  }
}
