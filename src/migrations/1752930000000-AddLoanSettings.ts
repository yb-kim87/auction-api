import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLoanSettings1752930000000 implements MigrationInterface {
  name = "AddLoanSettings1752930000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "loan_settings" (
        "key" character varying NOT NULL,
        "value" real NOT NULL,
        CONSTRAINT "PK_loan_settings" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "loan_settings"`);
  }
}
