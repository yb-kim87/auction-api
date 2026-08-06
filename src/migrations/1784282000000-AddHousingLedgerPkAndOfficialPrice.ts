import { MigrationInterface, QueryRunner } from "typeorm";

/** 주택 공시가격(공동주택가격) 자체 조회 파이프라인의 기반 스키마
 * (사용자 요청, 2026-08-06: "나이스옥션이 쓰는 방식으로 우리 자체적으로
 * 공시가를 가져올 순 없나?"). */
export class AddHousingLedgerPkAndOfficialPrice1784282000000 implements MigrationInterface {
  name = "AddHousingLedgerPkAndOfficialPrice1784282000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auctions"
      ADD COLUMN IF NOT EXISTS "housingLedgerPk" text,
      ADD COLUMN IF NOT EXISTS "housingLedgerDongNm" text
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "housing_official_price" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "housingLedgerPk" text,
        "sigunguCd" text NOT NULL DEFAULT '',
        "bjdongCd" text NOT NULL DEFAULT '',
        "mainBun" text NOT NULL DEFAULT '',
        "subBun" text NOT NULL DEFAULT '',
        "complexNm" text,
        "dongNm" text NOT NULL DEFAULT '',
        "hoNm" text NOT NULL DEFAULT '',
        "exclusiveArea" real,
        "postedPrice" bigint NOT NULL,
        "stdYear" text NOT NULL,
        "importedAt" text,
        CONSTRAINT "PK_housing_official_price" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_housing_price_ledger_ho"
      ON "housing_official_price" ("housingLedgerPk", "hoNm")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_housing_price_ledger_ho_year"
      ON "housing_official_price" ("housingLedgerPk", "hoNm", "stdYear")
      WHERE "housingLedgerPk" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "housing_official_price"`);
    await queryRunner.query(`
      ALTER TABLE "auctions"
      DROP COLUMN IF EXISTS "housingLedgerPk",
      DROP COLUMN IF EXISTS "housingLedgerDongNm"
    `);
  }
}
