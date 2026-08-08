import { MigrationInterface, QueryRunner } from "typeorm";

/** 주차(섹션)별 강의자료 파일 테이블(사용자 요청, 2026-08-08: "강의실에서
 * 해당 주차에 대한 강의자료 올릴 수 있는 기능을 넣어줘"). 파일 바이트를
 * bytea로 직접 저장한다 — 백엔드(Railway)/프론트(Vercel)가 분리
 * 배포되어 로컬 파일시스템에 저장하면 재배포 시 유실되기 때문. */
export class CreateLectureSectionMaterials1784289000000 implements MigrationInterface {
  name = "CreateLectureSectionMaterials1784289000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecture_section_materials" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "sectionId" uuid NOT NULL,
        "title" varchar NOT NULL,
        "fileName" varchar NOT NULL,
        "mimeType" varchar NOT NULL,
        "fileData" bytea NOT NULL,
        "fileSize" integer NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lecture_section_materials" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lecture_section_materials_sectionId"
      ON "lecture_section_materials" ("sectionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_section_materials"`);
  }
}
