import { MigrationInterface, QueryRunner } from "typeorm";

/** 관리자가 붙여넣기/업로드로 슬라이드에 자유위치 이미지를 추가할 수 있게
 * images 컬럼을 추가한다 (사용자 요청 — "완성된 html 강의자료 슬라이드에
 * 이미지를 붙여넣기 할 수 있게 해달라", 2026-07-24). */
export class AddLectureSlideImages1784239000000 implements MigrationInterface {
  name = "AddLectureSlideImages1784239000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_slides" ADD COLUMN IF NOT EXISTS "images" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_slides" DROP COLUMN IF EXISTS "images"
    `);
  }
}
