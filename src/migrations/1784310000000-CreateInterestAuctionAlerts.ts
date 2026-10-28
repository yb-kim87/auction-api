import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInterestAuctionAlerts1784310000000 implements MigrationInterface {
  name = "CreateInterestAuctionAlerts1784310000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "interest_auction_alerts" ("auctionId" varchar PRIMARY KEY, "status" text NOT NULL DEFAULT 'pending', "attempts" integer NOT NULL DEFAULT 0, "nextAttemptAt" timestamp NOT NULL, "createdAt" timestamp NOT NULL, "sentAt" timestamp, "lastError" text)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_interest_auction_alerts_pending" ON "interest_auction_alerts" ("status", "nextAttemptAt")`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "interest_auction_alerts"`);
  }
}
