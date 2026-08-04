import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddCourseVideoChapters1784269000000 implements MigrationInterface {
  name = "AddCourseVideoChapters1784269000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "course_videos" ADD COLUMN IF NOT EXISTS "chapters" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "course_videos" DROP COLUMN IF EXISTS "chapters"`);
  }
}
