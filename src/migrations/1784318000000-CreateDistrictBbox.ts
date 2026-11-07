import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 구별 조회 범위(bbox) 캐시 테이블 — 사용자 요청, 2026-11-07. */
export class CreateDistrictBbox1784318000000 implements MigrationInterface {
  name = "CreateDistrictBbox1784318000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "redevelopment_district_bbox" (
      "code" varchar PRIMARY KEY,
      "minLat" double precision NOT NULL,
      "maxLat" double precision NOT NULL,
      "minLng" double precision NOT NULL,
      "maxLng" double precision NOT NULL,
      "updatedAt" timestamptz NOT NULL DEFAULT now()
    )`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_district_bbox"`);
  }
}
