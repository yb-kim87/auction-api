import { MigrationInterface, QueryRunner } from "typeorm";

/** 한방(karhanbang.com) 부동산 중개업소 수집 결과 테이블(사용자 요청,
 * 2026-08-10: "부동산 중개인 연락처 등을 수집하는" 기존 데스크톱
 * 프로그램(hanbang.py)을 관리자 페이지 "부동산수집" 탭으로 이식). */
export class CreateRealtorOffices1784291000000 implements MigrationInterface {
  name = "CreateRealtorOffices1784291000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "realtor_offices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "memNo" varchar NOT NULL,
        "sidoCode" varchar NOT NULL,
        "sidoName" varchar NOT NULL,
        "gugunCode" varchar NOT NULL,
        "gugunName" varchar NOT NULL,
        "dongCode" varchar NOT NULL DEFAULT '',
        "dongName" varchar NOT NULL DEFAULT '',
        "name" varchar NOT NULL,
        "managerName" varchar NOT NULL DEFAULT '',
        "address" varchar NOT NULL DEFAULT '',
        "landline" varchar NOT NULL DEFAULT '',
        "mobilePrimary" varchar NOT NULL DEFAULT '',
        "mobileAll" varchar NOT NULL DEFAULT '',
        "detailUrl" varchar NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_realtor_offices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_realtor_offices_memNo" ON "realtor_offices" ("memNo")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_realtor_offices_sidoCode" ON "realtor_offices" ("sidoCode")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_realtor_offices_gugunCode" ON "realtor_offices" ("gugunCode")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_realtor_offices_dongCode" ON "realtor_offices" ("dongCode")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "realtor_offices"`);
  }
}
