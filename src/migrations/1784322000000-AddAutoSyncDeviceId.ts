import { MigrationInterface, QueryRunner } from "typeorm";

/** 재개발닷컴 호출에 쓰는 디바이스 아이디(x-jdc-device-id)를 관리자가 화면에서 바꿔 저장해 두는 컬럼. 비어 있으면 환경변수/코드 기본값을 쓴다. */
export class AddAutoSyncDeviceId1784322000000 implements MigrationInterface {
  name = "AddAutoSyncDeviceId1784322000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" ADD COLUMN IF NOT EXISTS "deviceId" text NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redevelopment_zone_auto_sync" DROP COLUMN IF EXISTS "deviceId"`);
  }
}
