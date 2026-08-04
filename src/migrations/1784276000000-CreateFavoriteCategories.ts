import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateFavoriteCategories1784276000000 implements MigrationInterface {
  name = "CreateFavoriteCategories1784276000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "favorite_categories" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" character varying NOT NULL,
        "name" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_favorite_categories" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_favorite_categories_user_name" UNIQUE ("userId", "name")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "favorite_categories" ("userId", "name")
      SELECT DISTINCT "userId", "category"
      FROM "auction_favorites"
      WHERE "category" IS NOT NULL AND TRIM("category") <> ''
      ON CONFLICT ("userId", "name") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "favorite_categories"`);
  }
}
