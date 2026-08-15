import { MigrationInterface, QueryRunner } from "typeorm";

/** 과제 등록/코치 피드백 알림톡 설정 컬럼 추가(사용자 요청, 2026-08-15).
 * 기본값은 모두 꺼짐/빈 문자열 — 관리자가 과제 검토 탭에서 켜기 전까지는
 * 아무 알림도 나가지 않는다. */
export class AddAssignmentNotifySettings1784294000000 implements MigrationInterface {
  name = "AddAssignmentNotifySettings1784294000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "assignmentNotifyEnabled" boolean NOT NULL DEFAULT false
    `);
    const textColumns = ["assignmentNotifyCoachPhone", "assignmentCreatedTemplateCode", "coachFeedbackTemplateCode"];
    for (const column of textColumns) {
      await queryRunner.query(`
        ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "${column}" text NOT NULL DEFAULT ''
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const columns = [
      "assignmentNotifyEnabled",
      "assignmentNotifyCoachPhone",
      "assignmentCreatedTemplateCode",
      "coachFeedbackTemplateCode",
    ];
    for (const column of columns) {
      await queryRunner.query(`ALTER TABLE "app_settings" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
