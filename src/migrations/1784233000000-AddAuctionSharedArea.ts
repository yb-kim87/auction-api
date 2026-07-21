import { MigrationInterface, QueryRunner } from "typeorm";

/** 탱크옥션 getEnvBldg.php(전유부/공용부 면적 상세)에서 얻는 공용면적(㎡).
 * 85㎡ 초과 여부는 전용면적(area)만으로 판단하지만, 부가세계산기의 건물
 * 기준시가 산정에는 전용+공용 합산 면적이 필요하다(실측, 2026-07-21). */
export class AddAuctionSharedArea1784233000000 implements MigrationInterface {
  name = "AddAuctionSharedArea1784233000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "sharedArea" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "sharedArea"`);
  }
}
