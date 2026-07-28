import { MigrationInterface, QueryRunner } from "typeorm";

/** 낙찰물건 매도 추정(재판매 매칭) 기능의 기준일 컬럼.
 * 설계: docs/auction-resale-matching-design.md 1장·6.1절. */
export class AddAuctionResaleMatchDates1784249000000 implements MigrationInterface {
  name = "AddAuctionResaleMatchDates1784249000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "saleConfirmedAt" date NULL,
      ADD COLUMN IF NOT EXISTS "paymentCompletedAt" date NULL,
      ADD COLUMN IF NOT EXISTS "paymentCompletedAtIsEstimated" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "lawdCd" text NULL,
      ADD COLUMN IF NOT EXISTS "umdNm" text NULL,
      ADD COLUMN IF NOT EXISTS "jibun" text NULL
    `);
    // "완납됐는데 아직 매칭 안 된" 물건을 빠르게 조회하는 부분 인덱스는
    // resaleMatchedTradeId 컬럼이 생기는 후속 마이그레이션
    // (AddAuctionResaleMatchDenormalizedColumns)에서 함께 생성한다.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      DROP COLUMN IF EXISTS "saleConfirmedAt",
      DROP COLUMN IF EXISTS "paymentCompletedAt",
      DROP COLUMN IF EXISTS "paymentCompletedAtIsEstimated",
      DROP COLUMN IF EXISTS "lawdCd",
      DROP COLUMN IF EXISTS "umdNm",
      DROP COLUMN IF EXISTS "jibun"
    `);
  }
}
