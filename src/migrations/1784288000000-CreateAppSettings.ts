import { MigrationInterface, QueryRunner } from "typeorm";

/** 사이트 전역 설정 싱글톤 테이블 — 첫 설정: 물건 상세 "등기·임차인
 * 정보" 섹션을 수강생 이하 등급에게 숨길지 여부(사용자 요청,
 * 2026-08-08). */
export class CreateAppSettings1784288000000 implements MigrationInterface {
  name = "CreateAppSettings1784288000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "app_settings" (
        "id" varchar NOT NULL DEFAULT 'singleton',
        "hideRegistryTenantForStudents" boolean NOT NULL DEFAULT true,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "app_settings"`);
  }
}
