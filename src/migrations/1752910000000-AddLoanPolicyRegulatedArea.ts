import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLoanPolicyRegulatedArea1752910000000 implements MigrationInterface {
  name = "AddLoanPolicyRegulatedArea1752910000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "appraisalRatio" real NOT NULL DEFAULT 1`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "regulatedArea" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "loanUnavailable" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "loan_policies" ADD COLUMN IF NOT EXISTS "businessLoanOnly" boolean NOT NULL DEFAULT false`,
    );

    // 규제지역 목록(구/시 단위, 관리자가 관리). 물건의 city/district와 매칭해
    // 규제지역 여부를 실시간으로 판정한다(물건별 수동 지정 대신).
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "regulated_regions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_regulated_regions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_regulated_regions_name" UNIQUE ("name")
      )
    `);

    // 구 정책 체계(first_time/no_house/one_house/multi_house)는 새 규제지역 기반
    // 체계로 대체되므로 제거한다. 서버 재시작 시 loan-policy.service의
    // onModuleInit이 새 기본 정책(regulated_no_house 등)을 자동 생성한다.
    await queryRunner.query(
      `DELETE FROM "loan_policies" WHERE "id" IN ('first_time', 'no_house', 'one_house', 'multi_house')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "regulated_regions"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "businessLoanOnly"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "loanUnavailable"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "regulatedArea"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "appraisalRatio"`);
  }
}
