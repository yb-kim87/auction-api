import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의자료(웨비나 슬라이드) 텍스트를 관리자 페이지에서 편집할 수 있도록 DB에
 * 저장한다. 1번 슬라이드(표지)만 우선 시드하고, 나머지 슬라이드는 파일럿 검증
 * 후 추가한다 (사용자 요청 — 관리자 페이지에 강의자료 탭, 2026-07-24). */
export class AddLectureSlidesTable1784236000000 implements MigrationInterface {
  name = "AddLectureSlidesTable1784236000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lecture_slides" (
        "id" character varying NOT NULL,
        "deckId" character varying NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "label" character varying NOT NULL,
        "content" jsonb NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_lecture_slides_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_lecture_slides_deckId" ON "lecture_slides" ("deckId")
    `);
    await queryRunner.query(`
      INSERT INTO "lecture_slides" ("id", "deckId", "sortOrder", "label", "content")
      VALUES (
        'webinar-2607_slide-01',
        'webinar-2607',
        0,
        '01. 표지',
        '{"titleLine1": "경매 투자 성공", "titleLine2": "스토리와 전략", "subtitle": "부동산 경매를 통한 자산 50억 달성 여정"}'::jsonb
      )
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lecture_slides"`);
  }
}
