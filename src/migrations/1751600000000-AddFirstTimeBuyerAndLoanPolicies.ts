import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFirstTimeBuyerAndLoanPolicies1751600000000
  implements MigrationInterface
{
  name = "AddFirstTimeBuyerAndLoanPolicies1751600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firstTimeBuyer" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "loan_policies" (
        "id" character varying NOT NULL,
        "label" character varying NOT NULL,
        "loanRatio" real NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_loan_policies_id" PRIMARY KEY ("id")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_policies"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "firstTimeBuyer"`,
    );
  }
}
