import { MigrationInterface, QueryRunner } from "typeorm";

/** 사건번호는 법원마다 독립적으로 채번되어 서로 다른 법원의 별개 사건이
 * 같은 번호를 쓸 수 있다(실측: "2025타경12336"이 서울북부2계·서울남부4계·
 * 천안7계에 각각 별개로 존재, 2026-07-19). 법원+계를 별도 컬럼으로 저장해
 * auctionNoNorm(물건 식별 고유 키)에 함께 반영한다. */
export class AddAuctionCourt1784230000000 implements MigrationInterface {
  name = "AddAuctionCourt1784230000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "court" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "court"`);
  }
}
