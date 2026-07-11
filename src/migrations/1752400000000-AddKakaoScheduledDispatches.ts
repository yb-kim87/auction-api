import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoScheduledDispatches1752400000000 implements MigrationInterface {
  name = "AddKakaoScheduledDispatches1752400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_scheduled_dispatches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying NOT NULL DEFAULT 'bulk',
        "leadIdsJson" text NOT NULL DEFAULT '[]',
        "testPhone" character varying NOT NULL DEFAULT '',
        "testName" character varying NOT NULL DEFAULT '',
        "templateCode" character varying NOT NULL,
        "templateName" character varying NOT NULL DEFAULT '',
        "variablesJson" text NOT NULL DEFAULT '{}',
        "templateNameVar" character varying NOT NULL DEFAULT '회원명',
        "scheduledAt" TIMESTAMP NOT NULL,
        "status" character varying NOT NULL DEFAULT 'scheduled',
        "targetCount" integer NOT NULL DEFAULT 0,
        "successCount" integer,
        "failedCount" integer,
        "errorMessage" text,
        "createdByAdmin" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "processedAt" TIMESTAMP,
        CONSTRAINT "PK_kakao_scheduled_dispatches_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_scheduled_dispatches_scheduled_at" ON "kakao_scheduled_dispatches" ("scheduledAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_scheduled_dispatches_status" ON "kakao_scheduled_dispatches" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_scheduled_dispatches"`);
  }
}
