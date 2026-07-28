import { MigrationInterface, QueryRunner } from "typeorm";

/** 배치로 계산된 매칭 결과를 목록 조회용으로 auctions 테이블에
 * 비정규화 저장(부가세계산 캐싱 vatPnu 등과 동일 패턴). 설계:
 * docs/auction-resale-matching-design.md 6.1절. */
export class AddAuctionResaleMatchDenormalizedColumns1784252000000
  implements MigrationInterface
{
  name = "AddAuctionResaleMatchDenormalizedColumns1784252000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "resaleMatchedTradeId" uuid NULL,
      ADD COLUMN IF NOT EXISTS "resaleMatchScore" integer NULL,
      ADD COLUMN IF NOT EXISTS "resaleMatchTier" text NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auctions_payment_completed_pending"
      ON "auctions" ("paymentCompletedAt")
      WHERE "paymentCompletedAt" IS NOT NULL AND "resaleMatchedTradeId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auctions_payment_completed_pending"`);
    await queryRunner.query(`
      ALTER TABLE "auctions"
      DROP COLUMN IF EXISTS "resaleMatchedTradeId",
      DROP COLUMN IF EXISTS "resaleMatchScore",
      DROP COLUMN IF EXISTS "resaleMatchTier"
    `);
  }
}
