import { MigrationInterface, QueryRunner } from "typeorm";

/** 과제제출의 "주변 안전마진 조사"를 조사 1건당 단일 숫자 입력에서
 * 경매사건번호/시세/낙찰가 3개 입력 + 자동계산 안전마진으로 확장한다
 * (사용자 요청, 2026-08-15). 기존 safetyResearchN(안전마진 값)은 그대로
 * 두고, 사건번호/시세/낙찰가 컬럼만 추가한다. */
export class AddSafetyResearchDetailColumns1784292000000 implements MigrationInterface {
  name = "AddSafetyResearchDetailColumns1784292000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const textColumns = ["safetyResearch1CaseNo", "safetyResearch2CaseNo", "safetyResearch3CaseNo"];
    for (const column of textColumns) {
      await queryRunner.query(`
        ALTER TABLE "auction_assignments" ADD COLUMN IF NOT EXISTS "${column}" text NOT NULL DEFAULT ''
      `);
    }
    const bigintColumns = [
      "safetyResearch1MarketPrice",
      "safetyResearch1BidPrice",
      "safetyResearch2MarketPrice",
      "safetyResearch2BidPrice",
      "safetyResearch3MarketPrice",
      "safetyResearch3BidPrice",
    ];
    for (const column of bigintColumns) {
      await queryRunner.query(`
        ALTER TABLE "auction_assignments" ADD COLUMN IF NOT EXISTS "${column}" bigint NOT NULL DEFAULT 0
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      "safetyResearch1CaseNo",
      "safetyResearch1MarketPrice",
      "safetyResearch1BidPrice",
      "safetyResearch2CaseNo",
      "safetyResearch2MarketPrice",
      "safetyResearch2BidPrice",
      "safetyResearch3CaseNo",
      "safetyResearch3MarketPrice",
      "safetyResearch3BidPrice",
    ];
    for (const column of columns) {
      await queryRunner.query(`ALTER TABLE "auction_assignments" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
