import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKakaoNotifyTables1752300000000 implements MigrationInterface {
  name = "AddKakaoNotifyTables1752300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_leads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "source" character varying NOT NULL,
        "sourceRefId" character varying NOT NULL,
        "name" character varying NOT NULL DEFAULT '',
        "phone" character varying NOT NULL,
        "email" character varying NOT NULL DEFAULT '',
        "gender" character varying NOT NULL DEFAULT '',
        "birthDate" character varying NOT NULL DEFAULT '',
        "address" character varying NOT NULL DEFAULT '',
        "adName" character varying NOT NULL DEFAULT '',
        "joinedAt" TIMESTAMP,
        "rawPayload" text NOT NULL DEFAULT '',
        "status" character varying NOT NULL DEFAULT 'pending',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kakao_leads_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_kakao_leads_source_ref" UNIQUE ("source", "sourceRefId"),
        CONSTRAINT "UQ_kakao_leads_phone" UNIQUE ("phone")
      )`,
    );
    // 전화번호 중복 방지는 소스 전역이 아니라 소스별로만 적용한다(같은 사람이
    // 서로 다른 경로로 신청하면 각각 별도 리드로 등록·발송되어야 하므로).
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" DROP CONSTRAINT IF EXISTS "UQ_kakao_leads_phone"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_leads" ADD CONSTRAINT "UQ_kakao_leads_source_phone" UNIQUE ("source", "phone")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_source" ON "kakao_leads" ("source")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_leads_status" ON "kakao_leads" ("status")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_dispatch_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "leadId" character varying,
        "attemptNo" integer NOT NULL DEFAULT 1,
        "templateCode" character varying NOT NULL DEFAULT '',
        "requestPayload" text NOT NULL DEFAULT '',
        "responsePayload" text NOT NULL DEFAULT '',
        "result" character varying NOT NULL,
        "errorMessage" text,
        "triggeredBy" character varying NOT NULL DEFAULT 'auto',
        "triggeredByAdmin" character varying,
        "sentAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kakao_dispatch_logs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_dispatch_logs_lead_id" ON "kakao_dispatch_logs" ("leadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_kakao_dispatch_logs_result" ON "kakao_dispatch_logs" ("result")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_sync_state" (
        "source" character varying NOT NULL,
        "lastSyncedAt" TIMESTAMP,
        "lastCursor" character varying,
        "lastRunAt" TIMESTAMP,
        "lastRunStatus" character varying NOT NULL DEFAULT 'never_run',
        "lastErrorMessage" text,
        CONSTRAINT "PK_kakao_sync_state_source" PRIMARY KEY ("source")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "kakao_sync_state" ADD COLUMN IF NOT EXISTS "configJson" text NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "kakao_notify_settings" (
        "key" character varying NOT NULL,
        "templateCode" character varying NOT NULL DEFAULT '',
        "templateName" character varying NOT NULL DEFAULT '',
        "variablesJson" text NOT NULL DEFAULT '{}',
        "templateNameVar" character varying NOT NULL DEFAULT '회원명',
        CONSTRAINT "PK_kakao_notify_settings_key" PRIMARY KEY ("key")
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_notify_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_sync_state"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_dispatch_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kakao_leads"`);
  }
}
