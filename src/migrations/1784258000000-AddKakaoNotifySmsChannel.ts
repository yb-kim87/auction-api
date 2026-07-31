import type { MigrationInterface, QueryRunner } from "typeorm";

/** 알림톡(카카오)뿐 아니라 문자(SMS/LMS, 솔라피 동일 API)도 선택 발송할 수
 *  있도록 채널 구분 컬럼을 추가한다. */
export class AddKakaoNotifySmsChannel1784258000000 implements MigrationInterface {
  name = "AddKakaoNotifySmsChannel1784258000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kakao_dispatch_logs"
        ADD COLUMN IF NOT EXISTS "channel" text NOT NULL DEFAULT 'alimtalk',
        ADD COLUMN IF NOT EXISTS "messageText" text
    `);
    await queryRunner.query(`
      ALTER TABLE "kakao_notify_settings"
        ADD COLUMN IF NOT EXISTS "channel" text NOT NULL DEFAULT 'alimtalk',
        ADD COLUMN IF NOT EXISTS "smsText" text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "kakao_scheduled_dispatches"
        ADD COLUMN IF NOT EXISTS "channel" text NOT NULL DEFAULT 'alimtalk',
        ADD COLUMN IF NOT EXISTS "smsText" text NOT NULL DEFAULT ''
    `);
    await queryRunner.query(`
      ALTER TABLE "kakao_scheduled_dispatches"
        ALTER COLUMN "templateCode" SET DEFAULT ''
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "kakao_dispatch_logs" DROP COLUMN IF EXISTS "channel"`);
    await queryRunner.query(`ALTER TABLE "kakao_dispatch_logs" DROP COLUMN IF EXISTS "messageText"`);
    await queryRunner.query(`ALTER TABLE "kakao_notify_settings" DROP COLUMN IF EXISTS "channel"`);
    await queryRunner.query(`ALTER TABLE "kakao_notify_settings" DROP COLUMN IF EXISTS "smsText"`);
    await queryRunner.query(`ALTER TABLE "kakao_scheduled_dispatches" DROP COLUMN IF EXISTS "channel"`);
    await queryRunner.query(`ALTER TABLE "kakao_scheduled_dispatches" DROP COLUMN IF EXISTS "smsText"`);
  }
}
