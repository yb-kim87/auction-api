import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발 구역 매물 조사(네이버 매매 매물 + 국토부 빌라 실거래) 저장 테이블 + 주소 좌표 캐시.
 * 사용자 요청, 2026-10-24: "관심매물을 등록하면 같은 재개발 구역 안 매물(호가)·실거래를 조사". */
export class CreateRedevelopmentResearchTables1784301000000 implements MigrationInterface {
  name = "CreateRedevelopmentResearchTables1784301000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_naver_listings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zoneId" character varying NOT NULL,
        "articleNo" text NOT NULL,
        "cortarNo" text NOT NULL DEFAULT '',
        "tradeType" text NULL,
        "typeName" text NULL,
        "articleName" text NULL,
        "priceText" text NULL,
        "priceManwon" integer NULL,
        "supplyArea" double precision NULL,
        "exclusiveArea" double precision NULL,
        "roomCount" integer NULL,
        "floorInfo" text NULL,
        "direction" text NULL,
        "confirmedAt" text NULL,
        "feature" text NULL,
        "realtor" text NULL,
        "realtorPhone" text NULL,
        "lat" double precision NULL,
        "lng" double precision NULL,
        "distanceToZoneM" integer NULL,
        "address" text NULL,
        "jibun" text NULL,
        "legalDongCode" text NULL,
        "buildingYear" integer NULL,
        "useApprovalDate" text NULL,
        "ageTag" text NULL,
        "adminCostManwon" double precision NULL,
        "adminCostMemo" text NULL,
        "moveInText" text NULL,
        "featureDesc" text NULL,
        "introText" text NULL,
        "photoUrlsJson" text NULL,
        "rawListJson" text NOT NULL,
        "rawDetailJson" text NULL,
        "detailFetchedAt" TIMESTAMP NULL,
        "firstSeenAt" TIMESTAMP NOT NULL,
        "lastSeenAt" TIMESTAMP NOT NULL,
        "missCount" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_redevelopment_naver_listings" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_redev_naver_listing_zone_article" ON "redevelopment_naver_listings" ("zoneId", "articleNo")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redev_naver_listing_zone" ON "redevelopment_naver_listings" ("zoneId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_trades" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "zoneId" character varying NOT NULL,
        "lawdCd" text NOT NULL,
        "umdNm" text NOT NULL,
        "jibun" text NOT NULL,
        "legalDongCode" text NULL,
        "buildingName" text NOT NULL DEFAULT '',
        "floor" integer NOT NULL DEFAULT 0,
        "exclusiveArea" double precision NOT NULL,
        "landArea" double precision NULL,
        "buildYear" integer NULL,
        "dealAmountManwon" integer NOT NULL,
        "contractDate" text NOT NULL,
        "registeredAt" text NULL,
        "dealingType" text NULL,
        "buyerType" text NULL,
        "sellerType" text NULL,
        "houseType" text NULL,
        "isCancelled" boolean NOT NULL DEFAULT false,
        "cancelledAt" text NULL,
        "lat" double precision NULL,
        "lng" double precision NULL,
        "distanceToZoneM" integer NULL,
        "rawJson" text NOT NULL,
        "collectedAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_redevelopment_trades" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_redev_trade_natural" ON "redevelopment_trades"
        ("zoneId", "lawdCd", "umdNm", "jibun", "floor", "exclusiveArea", "contractDate", "dealAmountManwon")
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redev_trade_zone" ON "redevelopment_trades" ("zoneId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_research_runs" (
        "zoneId" character varying NOT NULL,
        "status" text NOT NULL DEFAULT 'idle',
        "phase" text NOT NULL DEFAULT '',
        "error" text NULL,
        "naverFetched" integer NOT NULL DEFAULT 0,
        "naverSaved" integer NOT NULL DEFAULT 0,
        "naverDetailDone" integer NOT NULL DEFAULT 0,
        "naverDetailRemaining" integer NOT NULL DEFAULT 0,
        "tradesFetched" integer NOT NULL DEFAULT 0,
        "tradesSaved" integer NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP NULL,
        "finishedAt" TIMESTAMP NULL,
        "updatedAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_redevelopment_research_runs" PRIMARY KEY ("zoneId")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "address_geocode_cache" (
        "address" text NOT NULL,
        "lat" double precision NULL,
        "lng" double precision NULL,
        "legalDongCode" text NULL,
        "failed" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_address_geocode_cache" PRIMARY KEY ("address")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "address_geocode_cache"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_research_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_trades"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_naver_listings"`);
  }
}
