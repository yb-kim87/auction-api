import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateCourtAuctionCrawlerTables1784298000000 implements MigrationInterface {
  name = "CreateCourtAuctionCrawlerTables1784298000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courtauction_crawler_state" (
        "id" varchar NOT NULL DEFAULT 'singleton',
        "running" boolean NOT NULL DEFAULT false,
        "phase" text NOT NULL DEFAULT 'idle',
        "matched" integer NOT NULL DEFAULT 0,
        "completed" integer NOT NULL DEFAULT 0,
        "created" integer NOT NULL DEFAULT 0,
        "updated" integer NOT NULL DEFAULT 0,
        "skipped" integer NOT NULL DEFAULT 0,
        "lastMessage" text,
        "error" text,
        "urls" text,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_courtauction_crawler_state" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courtauction_crawler_log" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "at" TIMESTAMP NOT NULL DEFAULT now(),
        "level" varchar(10) NOT NULL,
        "message" text NOT NULL,
        CONSTRAINT "PK_courtauction_crawler_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_courtauction_crawler_log_at" ON "courtauction_crawler_log" ("at")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "courtauction_saved_search" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "search" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_courtauction_saved_search" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "courtauction_saved_search"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_courtauction_crawler_log_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courtauction_crawler_log"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "courtauction_crawler_state"`);
  }
}
