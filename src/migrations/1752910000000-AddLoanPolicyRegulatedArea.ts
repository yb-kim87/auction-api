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
    await queryRunner.query(
      `ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "regulatedArea" boolean NOT NULL DEFAULT false`,
    );

    // 구 정책 체계(first_time/no_house/one_house/multi_house)는 새 규제지역 기반
    // 체계로 대체되므로 제거한다. 서버 재시작 시 loan-policy.service의
    // onModuleInit이 새 기본 정책(regulated_no_house 등)을 자동 생성한다.
    await queryRunner.query(
      `DELETE FROM "loan_policies" WHERE "id" IN ('first_time', 'no_house', 'one_house', 'multi_house')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auctions" DROP COLUMN IF EXISTS "regulatedArea"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "businessLoanOnly"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "loanUnavailable"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "regulatedArea"`);
    await queryRunner.query(`ALTER TABLE "loan_policies" DROP COLUMN IF EXISTS "appraisalRatio"`);
  }
}
