import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddCourseIsOtCourse1784264000000 implements MigrationInterface {
  name = "AddCourseIsOtCourse1784264000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "isOtCourse" boolean NOT NULL DEFAULT false
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "courses" DROP COLUMN IF EXISTS "isOtCourse"`);
  }
}
