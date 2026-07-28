import { MigrationInterface, QueryRunner } from "typeorm";

/** 낙찰물건 매도 추정 기능의 매칭 결과 테이블 — 평가된 후보 전부를
 * 저장해 감사·튜닝이 가능하게 한다(1등만 저장하지 않음). 설계:
 * docs/auction-resale-matching-design.md 6.4절. */
export class AddAuctionTradeMatchTable1784251000000 implements MigrationInterface {
  name = "AddAuctionTradeMatchTable1784251000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_trade_match" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "auctionId" uuid NOT NULL,
        "actualTradeId" uuid NOT NULL,
        "listingSnapshotId" uuid NULL,
        "candidateRank" integer NOT NULL,
        "scoreTotal" integer NOT NULL,
        "scoreBreakdown" jsonb NOT NULL,
        "confidenceTier" text NOT NULL,
        "isPreCompletion" boolean NOT NULL DEFAULT false,
        "isDisplayed" boolean NOT NULL DEFAULT false,
        "status" text NOT NULL DEFAULT 'CANDIDATE',
        "reviewedBy" text NULL,
        "reviewedAt" timestamp NULL,
        "computedAt" timestamp NOT NULL DEFAULT now(),
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auction_trade_match_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_auction_trade_match_auction" FOREIGN KEY ("auctionId")
          REFERENCES "auctions" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_auction_trade_match_trade" FOREIGN KEY ("actualTradeId")
          REFERENCES "actual_trade" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_auction_trade_match_pair"
      ON "auction_trade_match" ("auctionId", "actualTradeId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auction_trade_match_displayed"
      ON "auction_trade_match" ("auctionId") WHERE "isDisplayed" = true
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_auction_trade_match_status"
      ON "auction_trade_match" ("status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_trade_match"`);
  }
}
