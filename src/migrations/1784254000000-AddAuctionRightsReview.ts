import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionRightsReview1784254000000 implements MigrationInterface {
  name = "AddAuctionRightsReview1784254000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "rightsReview" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auctions" DROP COLUMN IF EXISTS "rightsReview"`,
    );
  }
}
