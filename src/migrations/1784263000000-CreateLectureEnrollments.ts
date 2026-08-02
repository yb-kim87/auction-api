import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateLectureEnrollments1784263000000 implements MigrationInterface {
  name = "CreateLectureEnrollments1784263000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecture_enrollments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" text NOT NULL,
        "courseId" uuid NOT NULL,
        "startsAt" timestamptz NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "status" text NOT NULL DEFAULT 'ACTIVE',
        "createdAt" timestamptz NOT NULL DEFAULT NOW(),
        "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_lecture_enrollments_username_courseId" UNIQUE ("username", "courseId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lecture_enrollments_username" ON "lecture_enrollments" ("username")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lecture_enrollments_courseId" ON "lecture_enrollments" ("courseId")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_enrollments"`);
  }
}
