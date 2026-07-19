import { MigrationInterface, QueryRunner } from "typeorm";

/** 21억(integer 최대) 넘는 고가 물건(감정가·최저가 등) 저장 시 500 에러가 나던
 * 문제를 고친다. 금액 관련 컬럼을 integer -> bigint로 확장. */
export class WidenAuctionMoneyColumnsToBigint1784229000000 implements MigrationInterface {
  name = "WidenAuctionMoneyColumnsToBigint1784229000000";

  private readonly columns = [
    "appraisedValue",
    "minPrice",
    "salePrice",
    "naverPrice",
    "diffNaverSale",
    "diffNaverMin",
    "diffNaverAppraised",
    "officialLandPrice",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "auctions" ALTER COLUMN "${column}" TYPE bigint USING "${column}"::bigint`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "auctions" ALTER COLUMN "${column}" TYPE integer USING "${column}"::integer`,
      );
    }
  }
}
