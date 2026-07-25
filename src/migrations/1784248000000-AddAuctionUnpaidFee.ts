import { MigrationInterface, QueryRunner } from "typeorm";

/** 탱크옥션 상세 API(AuctView.php)의 arersInfo(체납조사) 필드를 저장한다.
 * 기존엔 이 필드 자체를 파싱하지 않고 버리고 있었음(사용자 지적,
 * 2026-07-25: "관리비정보가 나오긴하는데... 가져와지나"). */
export class AddAuctionUnpaidFee1784248000000 implements MigrationInterface {
  name = "AddAuctionUnpaidFee1784248000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "unpaidFeeAmount" bigint NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "unpaidFeeNote" text NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "unpaidFeeCheckedAt" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      DROP COLUMN IF EXISTS "unpaidFeeAmount",
      DROP COLUMN IF EXISTS "unpaidFeeNote",
      DROP COLUMN IF EXISTS "unpaidFeeCheckedAt"
    `);
  }
}
