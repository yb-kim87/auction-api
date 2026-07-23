import { MigrationInterface, QueryRunner } from "typeorm";

/** 부가세계산기 자동계산 시 VWorld/건축물대장 API로 조회하는 값 중
 * 물건 고유값(바뀌지 않는 값)을 저장해 재계산 시 API 재호출을 줄인다.
 * 토지공시지가만 매년 갱신될 수 있어 계속 API로 새로 받고, 이 4개
 * 컬럼(PNU·구조·용도·층수)은 한 번 확보하면 그대로 재사용한다(사용자
 * 요청: "공시지가는 값이 변할 수 있으니까 호출해오고 나머지 고유값은
 * 저장해두자", 2026-07-24). */
export class AddAuctionVatBuildingInfo1784235000000 implements MigrationInterface {
  name = "AddAuctionVatBuildingInfo1784235000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "vatPnu" text NULL,
      ADD COLUMN IF NOT EXISTS "vatStructureName" text NULL,
      ADD COLUMN IF NOT EXISTS "vatMainPurposeName" text NULL,
      ADD COLUMN IF NOT EXISTS "vatGroundFloors" integer NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      DROP COLUMN IF EXISTS "vatPnu",
      DROP COLUMN IF EXISTS "vatStructureName",
      DROP COLUMN IF EXISTS "vatMainPurposeName",
      DROP COLUMN IF EXISTS "vatGroundFloors"
    `);
  }
}
