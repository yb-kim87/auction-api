import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuctionBidPlans1784261000000 implements MigrationInterface {
  name = "CreateAuctionBidPlans1784261000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_bid_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "username" text NOT NULL,
        "auctionId" text NOT NULL,
        "bidPrice" bigint NOT NULL,
        "salePrice" bigint NOT NULL,
        "finalProfit" bigint,
        "requiredEquity" bigint,
        "memo" text NOT NULL DEFAULT '',
        "inputsJson" text NOT NULL DEFAULT '{}',
        "createdAt" timestamptz NOT NULL DEFAULT NOW(),
        "updatedAt" timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT "UQ_auction_bid_plans_username_auctionId" UNIQUE ("username", "auctionId")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auction_bid_plans_username" ON "auction_bid_plans" ("username")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_bid_plans"`);
  }
}
