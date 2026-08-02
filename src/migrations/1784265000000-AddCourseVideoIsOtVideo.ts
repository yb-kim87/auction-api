import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddCourseVideoIsOtVideo1784265000000 implements MigrationInterface {
  name = "AddCourseVideoIsOtVideo1784265000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "course_videos" ADD COLUMN IF NOT EXISTS "isOtVideo" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "course_videos" DROP COLUMN IF EXISTS "isOtVideo"`);
  }
}
