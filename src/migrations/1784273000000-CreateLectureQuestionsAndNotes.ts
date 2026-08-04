import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLectureQuestionsAndNotes1784273000000 implements MigrationInterface {
  name = "CreateLectureQuestionsAndNotes1784273000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lecture_questions" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" varchar NOT NULL,
      "courseId" varchar NOT NULL, "videoId" varchar NOT NULL,
      "chapterStartSeconds" integer NOT NULL DEFAULT 0, "positionSeconds" integer NOT NULL DEFAULT 0,
      "question" text NOT NULL, "answer" text, "answeredAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_lecture_questions" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_questions_course" ON "lecture_questions" ("courseId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_questions_video" ON "lecture_questions" ("videoId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_questions_username" ON "lecture_questions" ("username")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "lecture_notes" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" varchar NOT NULL,
      "courseId" varchar NOT NULL, "videoId" varchar NOT NULL,
      "chapterStartSeconds" integer NOT NULL DEFAULT 0, "positionSeconds" integer NOT NULL DEFAULT 0,
      "content" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_lecture_notes" PRIMARY KEY ("id"))`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_notes_course" ON "lecture_notes" ("courseId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_notes_video" ON "lecture_notes" ("videoId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_lecture_notes_username" ON "lecture_notes" ("username")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_questions"`);
  }
}
