import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발 조사 매물 — 건축물대장 전유부 전용면적 합계(대지지분 추정 분모) — 사용자 요청, 2026-10-26. */
export class AddNaverListingExposedAreaSum1784309000000 implements MigrationInterface {
  name = "AddNaverListingExposedAreaSum1784309000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "exposedAreaSum" double precision`);
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "exposedAreaFetchedAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "exposedAreaFetchedAt"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "exposedAreaSum"`);
  }
}
