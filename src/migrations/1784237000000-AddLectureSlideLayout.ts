import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의자료 텍스트뿐 아니라 위치/폰트크기/색상 같은 레이아웃도 관리자 화면에서
 * 드래그로 편집할 수 있게 layout 컬럼을 추가한다 (사용자 요청 — "레이아웃 이동
 * 이런 것도 되면 좋겠다", 2026-07-24). */
export class AddLectureSlideLayout1784237000000 implements MigrationInterface {
  name = "AddLectureSlideLayout1784237000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_slides" ADD COLUMN IF NOT EXISTS "layout" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lecture_slides" DROP COLUMN IF EXISTS "layout"
    `);
  }
}
