import { MigrationInterface, QueryRunner } from "typeorm";
export class AddPhoneFinalToAssignments1784285000000 implements MigrationInterface {
  async up(q: QueryRunner) { await q.query(`ALTER TABLE auction_assignments ADD COLUMN IF NOT EXISTS "phoneFinal" text NOT NULL DEFAULT ''`); }
  async down(q: QueryRunner) { await q.query(`ALTER TABLE auction_assignments DROP COLUMN IF EXISTS "phoneFinal"`); }
}
