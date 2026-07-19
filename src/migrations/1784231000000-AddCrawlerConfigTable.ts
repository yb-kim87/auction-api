import { MigrationInterface, QueryRunner } from "typeorm";

/** 크롤러 설정(관심조건·매일 작업 예약 등)이 컨테이너 로컬 파일에만
 * 저장되어 Railway 재배포마다 초기화되던 문제를 고친다. DB에 저장해
 * 재배포와 무관하게 유지되도록 함. */
export class AddCrawlerConfigTable1784231000000 implements MigrationInterface {
  name = "AddCrawlerConfigTable1784231000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawler_config" (
        "key" character varying NOT NULL,
        "value" text NOT NULL,
        CONSTRAINT "PK_crawler_config_key" PRIMARY KEY ("key")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crawler_config"`);
  }
}
