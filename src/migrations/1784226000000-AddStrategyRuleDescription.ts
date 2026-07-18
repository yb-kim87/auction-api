import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStrategyRuleDescription1784226000000 implements MigrationInterface {
  name = "AddStrategyRuleDescription1784226000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "strategy_rules"
      ADD COLUMN IF NOT EXISTS "description" text NOT NULL DEFAULT ''
    `);
    // 기존에 라벨(strategy_labels)에 있던 설명을, 그 라벨이 연결된 전략 규칙으로 옮겨온다.
    await queryRunner.query(`
      UPDATE "strategy_rules" sr
      SET "description" = sl."description"
      FROM "strategy_labels" sl
      WHERE sl."strategyCode" = sr."strategyCode" AND sl."description" != ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "strategy_rules" DROP COLUMN IF EXISTS "description"`);
  }
}
