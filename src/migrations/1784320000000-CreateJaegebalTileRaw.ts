import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 타일 수동 수집 원본 저장 테이블. 수동으로 먼저 만든 jsonb 컬럼 버전이 있으면 text로 맞춘다. */
export class CreateJaegebalTileRaw1784320000000 implements MigrationInterface {
  name = "CreateJaegebalTileRaw1784320000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "jaegebal_tile_raw" ("tile_no" integer PRIMARY KEY, "device_id" text, "fetched_at" timestamptz NOT NULL DEFAULT now(), "status" integer, "item_count" integer, "raw" text)`,
    );
    await queryRunner.query(`ALTER TABLE "jaegebal_tile_raw" ALTER COLUMN "raw" TYPE text USING "raw"::text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "jaegebal_tile_raw"`);
  }
}
