import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddLoanPolicyRegulatedArea1752910000000이 migrations 테이블에는 기록됐지만
 * 실제로는 regulated_regions 테이블 생성이 실패한 상태로 남아있어(원인 불명,
 * uuid_generate_v4 미설치 등으로 추정) 재시도한다. uuid-ossp 확장을 먼저
 * 보장하고, gen_random_uuid()를 폴백으로 사용한다.
 */
export class AddRegulatedRegionsTableRetry1752920000000 implements MigrationInterface {
  name = "AddRegulatedRegionsTableRetry1752920000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regulated_regions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulated_regions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_regulated_regions_name" UNIQUE ("name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "regulated_regions"`);
  }
}
