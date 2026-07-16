import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSecurityLogIpExclusion1784214000000 implements MigrationInterface {
  name = "AddSecurityLogIpExclusion1784214000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_log_ip_exclusions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ip" varchar NOT NULL,
        "note" varchar NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_log_ip_exclusions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_security_log_ip_exclusions_ip" UNIQUE ("ip")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "security_log_ip_exclusions"`);
  }
}
