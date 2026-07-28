import { MigrationInterface, QueryRunner } from "typeorm";

/** 낙찰물건 매도 추정 기능의 정규화된 실거래 기록 테이블. 주 소스는
 * 국토교통부 공식 실거래가 API(RTMSDataSvcAptTrade). 단지 식별은
 * 단지명(aptNm) 텍스트가 아니라 지번(lawdCd+umdNm+jibun) 기준 —
 * 동명이인 단지 오매칭을 피하기 위함. 설계: docs/auction-resale-matching-design.md 6.2절. */
export class AddActualTradeTable1784250000000 implements MigrationInterface {
  name = "AddActualTradeTable1784250000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "actual_trade" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "lawdCd" text NOT NULL,
        "umdNm" text NOT NULL,
        "jibun" text NOT NULL,
        "aptNm" text NOT NULL,
        "naverComplexId" text NULL,
        "buildingDong" text NULL,
        "floor" integer NULL,
        "exclusiveArea" numeric(7,4) NOT NULL,
        "areaTypeLabel" text NULL,
        "dealAmount" bigint NOT NULL,
        "contractDate" date NOT NULL,
        "registeredAt" date NULL,
        "buyerType" text NULL,
        "sellerType" text NULL,
        "dealingType" text NULL,
        "isCancelled" boolean NOT NULL DEFAULT false,
        "cancelledAt" date NULL,
        "sourceType" text NOT NULL DEFAULT 'MOLIT_API',
        "sourceRaw" jsonb NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_actual_trade_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_actual_trade_natural_key" ON "actual_trade" (
        "lawdCd", "umdNm", "jibun", "floor", "exclusiveArea", "contractDate", "dealAmount"
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_actual_trade_address"
      ON "actual_trade" ("lawdCd", "umdNm", "jibun")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_actual_trade_naver_complex_area_date"
      ON "actual_trade" ("naverComplexId", "exclusiveArea", "contractDate")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "actual_trade"`);
  }
}
