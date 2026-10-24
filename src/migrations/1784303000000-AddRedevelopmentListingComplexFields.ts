import { MigrationInterface, QueryRunner } from "typeorm";

/** 네이버 fin.land 빌라 단지정보(article/key + complex/villa, 2026-10-25 실측)를 redevelopment_naver_listings에 추가.
 * 정확한 지번·도로명은 기존 address/jibun/legalDongCode 컬럼에 채우고, 단지 고유 정보는 아래 컬럼에 저장한다. */
export class AddRedevelopmentListingComplexFields1784303000000 implements MigrationInterface {
  name = "AddRedevelopmentListingComplexFields1784303000000";

  private readonly cols: Array<[string, string]> = [
    ["complexNumber", "integer"],
    ["complexName", "text"],
    ["roadAddress", "text"],
    ["totalHouseholdNumber", "integer"],
    ["constructionCompany", "text"],
    ["floorAreaRatio", "double precision"],
    ["buildingCoverageRatio", "double precision"],
    ["elevatorCount", "integer"],
    ["totalParkingCount", "integer"],
    ["approvalElapsedYear", "integer"],
    ["complexInfoJson", "text"],
    ["finFetchedAt", "TIMESTAMP"],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, type] of this.cols) {
      await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "${name}" ${type} NULL`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name] of this.cols) {
      await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "${name}"`);
    }
  }
}
