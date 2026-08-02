import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuctionFavoriteCategory1784266000000 implements MigrationInterface {
  name = "AddAuctionFavoriteCategory1784266000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auction_favorites" ADD COLUMN IF NOT EXISTS "category" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auction_favorites" DROP COLUMN IF EXISTS "category"`,
    );
  }
}
