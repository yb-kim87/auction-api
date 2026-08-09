import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의자료를 파일 업로드(bytea) 방식에서 OneDrive 링크 등록 방식으로
 * 전환(사용자 요청, 2026-08-08: "OneDrive에서 다운받게 하는건?" → 링크
 * 등록 방식 채택). 파일 바이트 관련 컬럼을 제거하고 url 컬럼을 추가한다. */
export class ConvertLectureSectionMaterialsToUrl1784290000000 implements MigrationInterface {
  name = "ConvertLectureSectionMaterialsToUrl1784290000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials"
      ADD COLUMN IF NOT EXISTS "url" varchar NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" DROP COLUMN IF EXISTS "fileName"
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" DROP COLUMN IF EXISTS "mimeType"
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" DROP COLUMN IF EXISTS "fileData"
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" DROP COLUMN IF EXISTS "fileSize"
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" ALTER COLUMN "url" DROP DEFAULT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" ADD COLUMN IF NOT EXISTS "fileName" varchar NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" ADD COLUMN IF NOT EXISTS "mimeType" varchar NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" ADD COLUMN IF NOT EXISTS "fileData" bytea
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" ADD COLUMN IF NOT EXISTS "fileSize" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "lecture_section_materials" DROP COLUMN IF EXISTS "url"
    `);
  }
}
