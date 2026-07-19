import { MigrationInterface, QueryRunner } from "typeorm";

export class ConvertStrategyRuleLabelIdToLabelIds1784228000000
  implements MigrationInterface
{
  name = "ConvertStrategyRuleLabelIdToLabelIds1784228000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "strategy_rules"
      ADD COLUMN IF NOT EXISTS "labelIds" text
    `);

    // 기존 단일 labelId를 ["<id>"] 배열로 이관한다(전략 하나가 라벨 하나만
    // 가지던 구조 → 여러 개를 가질 수 있는 구조로 전환).
    await queryRunner.query(`
      UPDATE "strategy_rules"
      SET "labelIds" = json_build_array("labelId")::text
      WHERE "labelId" IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE "strategy_rules" DROP COLUMN IF EXISTS "labelId"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "strategy_rules"
      ADD COLUMN IF NOT EXISTS "labelId" varchar
    `);
    await queryRunner.query(`
      UPDATE "strategy_rules"
      SET "labelId" = (("labelIds"::json ->> 0))
    `);
    await queryRunner.query(`ALTER TABLE "strategy_rules" DROP COLUMN IF EXISTS "labelIds"`);
  }
}
