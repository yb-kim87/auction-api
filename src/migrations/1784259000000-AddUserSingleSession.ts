import type { MigrationInterface, QueryRunner } from "typeorm";

/** 계정당 동시 로그인 1개 제한(수강생 대상)을 위한 세션 추적 컬럼 추가. */
export class AddUserSingleSession1784259000000 implements MigrationInterface {
  name = "AddUserSingleSession1784259000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "currentSessionId" text,
        ADD COLUMN IF NOT EXISTS "sessionLastActiveAt" timestamptz
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "currentSessionId"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "sessionLastActiveAt"`);
  }
}
