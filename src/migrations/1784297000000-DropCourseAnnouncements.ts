import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의실 대시보드 "공지사항" 기능을 되돌린다 — 배포해봤더니 사용자가
 * "공지사항에 두기엔 안 어울린다"며 이전 상태(정적 빈 화면)로 되돌려
 * 달라고 요청함(2026-08-23). 앞서 CreateCourseAnnouncements 마이그레이션이
 * 이미 운영 DB에 적용되어 테이블이 존재하므로, 그대로 정리한다. */
export class DropCourseAnnouncements1784297000000 implements MigrationInterface {
  name = "DropCourseAnnouncements1784297000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "course_announcements"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "course_announcements" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "title" varchar NOT NULL,
        "body" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_course_announcements" PRIMARY KEY ("id")
      )
    `);
  }
}
