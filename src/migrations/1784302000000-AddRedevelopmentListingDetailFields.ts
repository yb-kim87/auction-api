import { MigrationInterface, QueryRunner } from "typeorm";

/** 네이버 매물 상세 실제 응답(2026-10-24 실측)에서 확인한 필드를 redevelopment_naver_listings에 추가.
 * pnu(법정동코드+본번+부번), 현재 전세 보증금(articlePrice.allWarrantPrice), 욕실/세대/주차/역 도보, 용도, 난방. */
export class AddRedevelopmentListingDetailFields1784302000000 implements MigrationInterface {
  name = "AddRedevelopmentListingDetailFields1784302000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const cols: Array<[string, string]> = [
      ["pnu", "text"],
      ["warrantPriceManwon", "integer"],
      ["bathroomCount", "integer"],
      ["householdCount", "integer"],
      ["parkingCount", "integer"],
      ["subwayWalkMin", "integer"],
      ["lawUsage", "text"],
      ["heatMethod", "text"],
    ];
    for (const [name, type] of cols) {
      await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "${name}" ${type} NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const name of ["pnu", "warrantPriceManwon", "bathroomCount", "householdCount", "parkingCount", "subwayWalkMin", "lawUsage", "heatMethod"]) {
      await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "${name}"`);
    }
  }
}
