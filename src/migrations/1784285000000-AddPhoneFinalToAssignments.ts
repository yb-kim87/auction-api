import { MigrationInterface, QueryRunner } from "typeorm";
export class AddPhoneFinalToAssignments1784285000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(`CREATE TABLE IF NOT EXISTS auction_assignments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), username varchar NOT NULL, "auctionId" varchar NOT NULL DEFAULT '', "auctionNo" varchar NOT NULL DEFAULT '', address varchar NOT NULL DEFAULT '', "marketResearch" text NOT NULL DEFAULT '', "phoneResearch" text NOT NULL DEFAULT '', "phoneBuyer" text NOT NULL DEFAULT '', "phoneSeller" text NOT NULL DEFAULT '', "phoneBidder" text NOT NULL DEFAULT '', "phoneFinal" text NOT NULL DEFAULT '', "safetyResearch1" text NOT NULL DEFAULT '', "safetyResearch2" text NOT NULL DEFAULT '', "safetyResearch3" text NOT NULL DEFAULT '', "finalSafetyMargin" text NOT NULL DEFAULT '', "finalMarketPrice" bigint NOT NULL DEFAULT 0, "targetBidPrice" bigint NOT NULL DEFAULT 0, "requiredEquity" bigint NOT NULL DEFAULT 0, "finalProfit" bigint NOT NULL DEFAULT 0, memo text NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'draft', "coachFeedback" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now())`);
    for (const c of ["phoneBuyer","phoneSeller","phoneBidder","phoneFinal","safetyResearch1","safetyResearch2","safetyResearch3","finalSafetyMargin"]) await q.query(`ALTER TABLE auction_assignments ADD COLUMN IF NOT EXISTS "${c}" text NOT NULL DEFAULT ''`);
    await q.query(`ALTER TABLE auction_assignments ADD COLUMN IF NOT EXISTS "finalProfit" bigint NOT NULL DEFAULT 0`);
  }
  async down(q: QueryRunner) { await q.query(`ALTER TABLE auction_assignments DROP COLUMN IF EXISTS "phoneFinal"`); }
}
