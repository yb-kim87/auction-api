import { MigrationInterface, QueryRunner } from "typeorm";

/** 운영에서 "column AuctionAssignment.phoneBuyer does not exist" 에러
 * 발생(2026-08-07, 과제제출 기능 실사용 테스트 중 발견) — 앞선
 * 마이그레이션(1784285000000/1784286000000)이 이미 커밋돼 있었는데도
 * 운영 DB에 컬럼이 실제로 반영되지 않은 상태였다. 원인을 직접 조회로
 * 확인하지 못해(로컬에서 Railway 내부망 DB에 접속 불가) 안전하게
 * 멱등(IF NOT EXISTS) 마이그레이션을 한 번 더 두어 엔티티가 요구하는
 * 컬럼 전체를 확실히 맞춘다. */
export class EnsureAssignmentColumnsAgain1784287000000 implements MigrationInterface {
  name = "EnsureAssignmentColumnsAgain1784287000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "auction_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar NOT NULL,
        "auctionId" varchar NOT NULL DEFAULT '',
        "auctionNo" varchar NOT NULL DEFAULT '',
        "address" varchar NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_auction_assignments" PRIMARY KEY ("id")
      )
    `);
    const textColumns = [
      "marketResearch",
      "phoneResearch",
      "phoneBuyer",
      "phoneSeller",
      "phoneBidder",
      "phoneFinal",
      "safetyResearch1",
      "safetyResearch2",
      "safetyResearch3",
      "finalSafetyMargin",
      "memo",
      "coachFeedback",
    ];
    for (const column of textColumns) {
      await queryRunner.query(`
        ALTER TABLE "auction_assignments" ADD COLUMN IF NOT EXISTS "${column}" text NOT NULL DEFAULT ''
      `);
    }
    const bigintColumns = ["finalMarketPrice", "targetBidPrice", "requiredEquity", "finalProfit"];
    for (const column of bigintColumns) {
      await queryRunner.query(`
        ALTER TABLE "auction_assignments" ADD COLUMN IF NOT EXISTS "${column}" bigint NOT NULL DEFAULT 0
      `);
    }
    await queryRunner.query(`
      ALTER TABLE "auction_assignments" ADD COLUMN IF NOT EXISTS "status" varchar NOT NULL DEFAULT 'draft'
    `);
  }

  public async down(): Promise<void> {
    // 컬럼 보강용 안전 마이그레이션 — 되돌리지 않는다.
  }
}
