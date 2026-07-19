import { MigrationInterface, QueryRunner } from "typeorm";

/** 탱크옥션 baseInfo.stateNm(진행/변경/취하/매각 등) 원문을 저장해, 취하·
 * 매각 확정된 사건을 "당일물건 조회" 재크롤링 대상에서 제외하는 데 쓴다. */
export class AddAuctionCaseState1784232000000 implements MigrationInterface {
  name = "AddAuctionCaseState1784232000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "caseState" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "caseState"`);
  }
}
