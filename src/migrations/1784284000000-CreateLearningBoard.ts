import { MigrationInterface, QueryRunner } from "typeorm";
export class CreateLearningBoard1784284000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE IF NOT EXISTS auction_assignments (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), username varchar NOT NULL, "auctionId" varchar NOT NULL DEFAULT '', "auctionNo" varchar NOT NULL DEFAULT '', address varchar NOT NULL DEFAULT '', "marketResearch" text NOT NULL DEFAULT '', "phoneResearch" text NOT NULL DEFAULT '', "finalMarketPrice" bigint NOT NULL DEFAULT 0, "targetBidPrice" bigint NOT NULL DEFAULT 0, "requiredEquity" bigint NOT NULL DEFAULT 0, memo text NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'draft', "coachFeedback" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now())`);
    await q.query(`CREATE TABLE IF NOT EXISTS service_reports (id uuid PRIMARY KEY DEFAULT uuid_generate_v4(), username varchar NOT NULL, type varchar NOT NULL DEFAULT 'bug', title varchar NOT NULL, description text NOT NULL DEFAULT '', reproduction text NOT NULL DEFAULT '', "expectedResult" text NOT NULL DEFAULT '', "actualResult" text NOT NULL DEFAULT '', "pageUrl" text NOT NULL DEFAULT '', status varchar NOT NULL DEFAULT 'received', "adminReply" text NOT NULL DEFAULT '', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now())`);
  }
  async down(q: QueryRunner) { await q.query(`DROP TABLE IF EXISTS service_reports`); await q.query(`DROP TABLE IF EXISTS auction_assignments`); }
}
