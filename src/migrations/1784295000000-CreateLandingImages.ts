import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의실 메인(/courses) 소개 페이지의 이미지 슬롯(landing_images) 테이블을 만든다.
 * 이 모듈(landing-images)이 코드는 이미 있었지만 app.module.ts에 등록돼 있지 않았고
 * 마이그레이션도 없어, 운영 API에서 GET /landing-images가 라우트 자체가 없어 404가
 * 나고 있었다(2026-08-20, 프론트 리팩터 검증 중 발견 — 2026-08-11 문서에 이미
 * "이번 배포 범위에서 제외"로 기록돼 있던 이슈). */
export class CreateLandingImages1784295000000 implements MigrationInterface {
  name = "CreateLandingImages1784295000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "landing_images" (
        "id" character varying NOT NULL,
        "imageUrl" character varying,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_landing_images" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "landing_images"`);
  }
}
