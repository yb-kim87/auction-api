import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSecurityLogAlerts1784300000000 implements MigrationInterface {
  name = "CreateSecurityLogAlerts1784300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_log_alerts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fingerprint" character varying NOT NULL,
        "ip" character varying NOT NULL,
        "ruleCode" character varying NOT NULL,
        "severity" character varying NOT NULL,
        "summary" text NOT NULL,
        "source" character varying NOT NULL DEFAULT 'rules',
        "telegramSent" boolean NOT NULL DEFAULT false,
        "suppressed" boolean NOT NULL DEFAULT false,
        "requestCount" integer NOT NULL DEFAULT 0,
        "pathsJson" text NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_log_alerts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_security_log_alerts_fingerprint_createdAt"
      ON "security_log_alerts" ("fingerprint", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "security_log_alerts"`);
  }
}
