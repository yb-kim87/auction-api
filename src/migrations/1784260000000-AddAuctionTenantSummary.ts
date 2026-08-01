import type { MigrationInterface, QueryRunner } from "typeorm";

/** 임차인 점유현황 원문(법률 용어 위주)을 AI로 1~2문장 요약해 캐싱할 컬럼. */
export class AddAuctionTenantSummary1784260000000 implements MigrationInterface {
  name = "AddAuctionTenantSummary1784260000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "tenantSummary" text
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "tenantSummary"`);
  }
}
