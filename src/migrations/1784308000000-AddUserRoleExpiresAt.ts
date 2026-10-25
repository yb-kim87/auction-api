import { MigrationInterface, QueryRunner } from "typeorm";

/** 수강생 등급 이용 기한(만료되면 승인대기로 자동 복귀) — 사용자 요청, 2026-10-26. */
export class AddUserRoleExpiresAt1784308000000 implements MigrationInterface {
  name = "AddUserRoleExpiresAt1784308000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "roleExpiresAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "roleExpiresAt"`);
  }
}
