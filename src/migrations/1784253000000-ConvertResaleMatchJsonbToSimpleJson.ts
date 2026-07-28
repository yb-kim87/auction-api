import { MigrationInterface, QueryRunner } from "typeorm";

/** actual_trade.sourceRaw / auction_trade_match.scoreBreakdown을
 * jsonb에서 text(TypeORM simple-json)로 전환. simple-json은 운영
 * PostgreSQL과 로컬 sql.js(개발용) 양쪽에서 동일하게 동작해 엔티티를
 * 이 타입으로 통일했다 — 이 두 테이블은 아직 실사용 전(Stage A/B
 * 미실행)이라 데이터 손실 없이 안전하게 변환 가능하다. */
export class ConvertResaleMatchJsonbToSimpleJson1784253000000
  implements MigrationInterface
{
  name = "ConvertResaleMatchJsonbToSimpleJson1784253000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "actual_trade"
      ALTER COLUMN "sourceRaw" TYPE text USING "sourceRaw"::text
    `);
    await queryRunner.query(`
      ALTER TABLE "auction_trade_match"
      ALTER COLUMN "scoreBreakdown" TYPE text USING "scoreBreakdown"::text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auction_trade_match"
      ALTER COLUMN "scoreBreakdown" TYPE jsonb USING "scoreBreakdown"::jsonb
    `);
    await queryRunner.query(`
      ALTER TABLE "actual_trade"
      ALTER COLUMN "sourceRaw" TYPE jsonb USING "sourceRaw"::jsonb
    `);
  }
}
