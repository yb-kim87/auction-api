import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAiPlatformTables1751800000000 implements MigrationInterface {
  name = "AddAiPlatformTables1751800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "item_normalized_data" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "itemId" character varying NOT NULL,
        "normalizedData" text NOT NULL,
        "normalizedSources" text NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_normalized_data_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_item_normalized_data_item_id" ON "item_normalized_data" ("itemId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "item_ai_features" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "itemId" character varying NOT NULL,
        "features" text NOT NULL,
        "featureSources" text NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_ai_features_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_item_ai_features_item_id" ON "item_ai_features" ("itemId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "item_ai_tags" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "itemId" character varying NOT NULL,
        "autoTags" text NOT NULL,
        "manualTags" text,
        "finalTags" text NOT NULL,
        "tagSources" text NOT NULL,
        "confidence" integer NOT NULL DEFAULT 100,
        "version" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_ai_tags_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_item_ai_tags_item_id" ON "item_ai_tags" ("itemId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "ai_platform_histories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "itemId" character varying NOT NULL,
        "engineType" character varying NOT NULL,
        "actionType" character varying NOT NULL,
        "beforeData" text,
        "afterData" text NOT NULL,
        "changedBy" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_platform_histories_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ai_platform_histories_item_engine" ON "ai_platform_histories" ("itemId", "engineType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ai_platform_histories"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "item_ai_tags"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "item_ai_features"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "item_normalized_data"`);
  }
}
