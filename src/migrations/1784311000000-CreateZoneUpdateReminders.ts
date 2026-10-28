import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 구역도 업데이트 정기 알림(2주) 발송 기록 — 사용자 요청, 2026-10-28. */
export class CreateZoneUpdateReminders1784311000000 implements MigrationInterface {
  name = "CreateZoneUpdateReminders1784311000000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "zone_update_reminders" ("id" varchar PRIMARY KEY, "lastSentAt" timestamp)`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "zone_update_reminders"`);
  }
}
