import { MigrationInterface, QueryRunner } from "typeorm";

export class DropStrategyLabelCodeUnique1784225000000 implements MigrationInterface {
  name = "DropStrategyLabelCodeUnique1784225000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // strategy_labels가 전략코드 종속 문구가 아니라 재사용 가능한 라벨 마스터로
    // 바뀌면서 strategyCode당 라벨 1개 제약이 더 이상 맞지 않는다.
    await queryRunner.query(`
      ALTER TABLE "strategy_labels" DROP CONSTRAINT IF EXISTS "UQ_strategy_labels_strategyCode"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_strategy_labels_strategyCode'
        ) THEN
          ALTER TABLE "strategy_labels" ADD CONSTRAINT "UQ_strategy_labels_strategyCode" UNIQUE ("strategyCode");
        END IF;
      END $$;
    `);
  }
}
