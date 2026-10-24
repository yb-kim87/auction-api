import { MigrationInterface, QueryRunner } from "typeorm";

/** 호가 대지지분 추정용: 건축물대장 표제부 대지면적(㎡)과 조회 시각(조회했지만 값이 없는 건물도 다시 부르지 않기 위함). */
export class AddRedevelopmentListingPlatArea1784304000000 implements MigrationInterface {
  name = "AddRedevelopmentListingPlatArea1784304000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "platArea" double precision NULL`);
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" ADD COLUMN IF NOT EXISTS "platAreaFetchedAt" TIMESTAMP NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "platAreaFetchedAt"`);
    await queryRunner.query(`ALTER TABLE "redevelopment_naver_listings" DROP COLUMN IF EXISTS "platArea"`);
  }
}
