import { MigrationInterface, QueryRunner } from "typeorm";

/** 새 구역의 정밀 경계를 아직 받지 않았다는 표시(관리자가 직접 요청해 받으면 비운다). 큰 범위 1회 요청으로 만든 거친 경계의 구역에 찍는다. */
export class AddZoneBoundaryPendingAt1784321000000 implements MigrationInterface {
  name = "AddZoneBoundaryPendingAt1784321000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" ADD COLUMN IF NOT EXISTS "boundaryPendingAt" timestamptz NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zones" DROP COLUMN IF EXISTS "boundaryPendingAt"`);
  }
}
