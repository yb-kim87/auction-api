import { MigrationInterface, QueryRunner } from "typeorm";

export class AddStrategyRuleLabelId1784227000000 implements MigrationInterface {
  name = "AddStrategyRuleLabelId1784227000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "strategy_rules"
      ADD COLUMN IF NOT EXISTS "labelId" uuid
    `);

    // 기존에는 strategy_labels.strategyCode로 "라벨 → 전략" 단일 연결을 표현했다.
    // 다대다로 전환하면서 그 연결을 strategy_rules.labelId(전략 → 라벨)로 옮긴다.
    await queryRunner.query(`
      UPDATE "strategy_rules" sr
      SET "labelId" = sl."id"
      FROM "strategy_labels" sl
      WHERE sl."strategyCode" = sr."strategyCode" AND sl."strategyCode" != ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "strategy_rules" DROP COLUMN IF EXISTS "labelId"`);
  }
}
