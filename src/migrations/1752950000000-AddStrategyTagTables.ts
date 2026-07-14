import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStrategyTagTables1752950000000 implements MigrationInterface {
  name = "AddStrategyTagTables1752950000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // tag_rules에 tagCode(Strategy 규칙이 참조할 안정적 코드) 추가.
    // 기존 행은 tagName을 대문자 슬러그로 변환해 채워서 unique 제약을 만족시킨다.
    await queryRunner.query(`
      ALTER TABLE "tag_rules" ADD COLUMN IF NOT EXISTS "tagCode" character varying
    `);
    await queryRunner.query(`
      UPDATE "tag_rules"
      SET "tagCode" = UPPER(REGEXP_REPLACE(TRIM("tagName"), '[^a-zA-Z0-9가-힣]+', '_', 'g')) || '_' || SUBSTRING("id"::text, 1, 8)
      WHERE "tagCode" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "tag_rules" ALTER COLUMN "tagCode" SET NOT NULL
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_tag_rules_tagCode'
        ) THEN
          ALTER TABLE "tag_rules" ADD CONSTRAINT "UQ_tag_rules_tagCode" UNIQUE ("tagCode");
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "strategy_rules" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "strategyCode" character varying NOT NULL,
        "requiredFactCodes" text NOT NULL,
        "active" boolean NOT NULL DEFAULT true,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_strategy_rules" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "strategy_labels" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "strategyCode" character varying NOT NULL,
        "label" character varying NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "icon" character varying NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_strategy_labels" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_strategy_labels_strategyCode" UNIQUE ("strategyCode")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy_labels"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "strategy_rules"`);
    await queryRunner.query(`ALTER TABLE "tag_rules" DROP CONSTRAINT IF EXISTS "UQ_tag_rules_tagCode"`);
    await queryRunner.query(`ALTER TABLE "tag_rules" DROP COLUMN IF EXISTS "tagCode"`);
  }
}
