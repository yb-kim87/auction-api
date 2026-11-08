import { MigrationInterface, QueryRunner } from "typeorm";

/** 경매물건이 재개발 구역 안이거나 경계 100m 이내인지 미리 계산해 둔 표시. 좌표는 전부 저장하고, 지도는 이 표시가 true인 물건만 가져온다. */
export class AddAuctionNearZone1784323000000 implements MigrationInterface {
  name = "AddAuctionNearZone1784323000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "nearZone" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_auctions_nearZone" ON "auctions" ("nearZone") WHERE "nearZone" = true`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_auctions_nearZone"`);
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "nearZone"`);
  }
}
