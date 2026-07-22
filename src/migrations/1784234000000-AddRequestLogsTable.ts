import { MigrationInterface, QueryRunner } from "typeorm";

/** 요청 로그를 파일(logs/requests.log)이 아니라 DB에 저장한다. 파일은
 * Railway 재배포마다 초기화되어 장기 보관이 안 됐고, 20MB 회전 이후
 * 옛 로그는 그냥 버려지고 있었다(사용자 요청 — 문제 조사를 위해 로그를
 * 남겨두고 싶다, 2026-07-22). */
export class AddRequestLogsTable1784234000000 implements MigrationInterface {
  name = "AddRequestLogsTable1784234000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "request_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ts" TIMESTAMP NOT NULL,
        "ip" character varying NOT NULL,
        "method" character varying NOT NULL,
        "path" character varying NOT NULL,
        "username" character varying NOT NULL DEFAULT '',
        "status" integer NOT NULL,
        "durationMs" integer NOT NULL,
        "userAgent" character varying NOT NULL DEFAULT '',
        CONSTRAINT "PK_request_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_request_logs_ts" ON "request_logs" ("ts")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "request_logs"`);
  }
}
