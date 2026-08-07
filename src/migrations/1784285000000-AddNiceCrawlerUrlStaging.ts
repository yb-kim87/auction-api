import { MigrationInterface, QueryRunner } from "typeorm";

/** 나이스 작업창에 탱크옥션과 동일한 작업목록(URL) 스테이징 흐름을
 * 추가한다 — "수집"으로 objId 목록을 만들고 다듬은 뒤 "조회 시작"으로
 * 처리(사용자 요청, 2026-08-07: "1 2번도 일단 붙이고 테스트 해보자"). */
export class AddNiceCrawlerUrlStaging1784285000000 implements MigrationInterface {
  name = "AddNiceCrawlerUrlStaging1784285000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state"
      ADD COLUMN IF NOT EXISTS "urls" text
    `);
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state"
      ADD COLUMN IF NOT EXISTS "resaleAnalysisEnabled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state" DROP COLUMN IF EXISTS "resaleAnalysisEnabled"
    `);
    await queryRunner.query(`
      ALTER TABLE "nice_crawler_state" DROP COLUMN IF EXISTS "urls"
    `);
  }
}
