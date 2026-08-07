import { MigrationInterface, QueryRunner } from "typeorm";

/** 나이스 작업창 검색조건 저장/즐겨찾기 + 시작 시 실행할 조건 저장
 * (사용자 요청, 2026-08-07). */
export class AddNiceSearchConfigTables1784284000000 implements MigrationInterface {
  name = "AddNiceSearchConfigTables1784284000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state"
      ADD COLUMN IF NOT EXISTS "searchConfig" text
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "nice_saved_search" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "search" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_nice_saved_search" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "nice_saved_search"`);
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state" DROP COLUMN IF EXISTS "searchConfig"
    `);
  }
}
