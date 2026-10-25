import { MigrationInterface, QueryRunner } from "typeorm";

/** 공시가격 조회(재개발 조사 결과·지도 팝업)는 (시군구, 법정동, 본번, 부번)으로 건물을 찾는데 이 컬럼들에 인덱스가 없어
 * 건물마다 테이블 전체를 훑었다 — 구역 팝업을 열 때 결과 표가 늦게 뜨던 원인(2026-10-25). */
export class AddHousingOfficialPriceAddressIndex1784306000000 implements MigrationInterface {
  name = "AddHousingOfficialPriceAddressIndex1784306000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_housing_price_addr" ON "housing_official_price" ("sigunguCd", "bjdongCd", "mainBun", "subBun")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_housing_price_addr"`);
  }
}
