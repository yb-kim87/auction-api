import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFactStrategyTags1752940000000 implements MigrationInterface {
  name = "AddFactStrategyTags1752940000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "factTags" text NOT NULL DEFAULT '[]'
    `);
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "strategyTags" text NOT NULL DEFAULT '[]'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "tag_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tagName" character varying NOT NULL,
        "category" character varying NOT NULL DEFAULT 'fact',
        "field" character varying NOT NULL,
        "operator" character varying NOT NULL,
        "value" character varying NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_tag_rules" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tag_rules"`);
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "strategyTags"`);
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "factTags"`);
  }
}
