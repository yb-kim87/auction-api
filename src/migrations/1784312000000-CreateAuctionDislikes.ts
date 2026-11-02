import { MigrationInterface, QueryRunner } from "typeorm";

/** 경매물건 싫어요(+사유) — 사용자 요청, 2026-11-02. */
export class CreateAuctionDislikes1784312000000 implements MigrationInterface {
  name = "CreateAuctionDislikes1784312000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "auction_dislikes" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "userId" character varying NOT NULL, "auctionId" character varying NOT NULL, "reason" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_auction_dislikes" PRIMARY KEY ("id"), CONSTRAINT "UQ_auction_dislikes_user_auction" UNIQUE ("userId", "auctionId"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "auction_dislikes"`);
  }
}
