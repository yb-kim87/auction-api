import { MigrationInterface, QueryRunner } from "typeorm";

/** 구 경계 캐시 테이블 삭제 — 구역도 업데이트를 서울·경기·인천 범위 1회 요청으로 바꿔 더 쓰지 않는다(2026-11-07). */
export class DropDistrictBbox1784319000000 implements MigrationInterface {
  name = "DropDistrictBbox1784319000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_district_bbox"`);
  }

  public async down(): Promise<void> {
    // 복구할 데이터가 없다(캐시였음).
  }
}
