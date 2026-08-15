import { MigrationInterface, QueryRunner } from "typeorm";

/** /courses/webinar(무료 웨비나 신청) 페이지의 카카오 로그인·ID/PW 회원가입
 * 신청자를 저장하는 테이블 두 개를 만든다. 이 모듈(webinar-auth)이 앱에는
 * 이미 등록돼 있었지만 마이그레이션이 없어 운영 DB에 테이블이 없는 상태였고,
 * 그 결과 관리자 화면 "웨비나 신청자" 탭이 라우트조차 뜨지 않았다
 * (2026-08-15, "Cannot GET /webinar-auth/kakao/leads" 신고로 발견). */
export class CreateWebinarAuthTables1784293000000 implements MigrationInterface {
  name = "CreateWebinarAuthTables1784293000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webinar_kakao_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kakaoId" text NOT NULL,
        "nickname" text NOT NULL DEFAULT '',
        "email" text NOT NULL DEFAULT '',
        "phone" text NOT NULL DEFAULT '',
        "profileImageUrl" text NOT NULL DEFAULT '',
        "rawPayload" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webinar_kakao_leads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webinar_kakao_leads_kakao_id" UNIQUE ("kakaoId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "webinar_email_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" text NOT NULL,
        "passwordHash" text NOT NULL,
        "name" text NOT NULL,
        "gender" text NOT NULL DEFAULT '',
        "phone" text NOT NULL,
        "homepage" text NOT NULL DEFAULT '',
        "address" text NOT NULL DEFAULT '',
        "addressDetail" text NOT NULL DEFAULT '',
        "recommendCode" text NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webinar_email_leads" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webinar_email_leads_email" UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "webinar_email_leads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "webinar_kakao_leads"`);
  }
}
