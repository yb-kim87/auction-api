import { MigrationInterface, QueryRunner } from "typeorm";
export class EnsureAssignmentColumns1784286000000 implements MigrationInterface {
  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE auction_assignments ADD COLUMN IF NOT EXISTS "phoneFinal" text NOT NULL DEFAULT ''`);
    await q.query(`ALTER TABLE auction_assignments ADD COLUMN IF NOT EXISTS "finalProfit" bigint NOT NULL DEFAULT 0`);
  }
  async down(q: QueryRunner) {}
}
