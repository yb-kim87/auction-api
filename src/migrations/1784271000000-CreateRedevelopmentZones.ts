import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateRedevelopmentZones1784271000000 implements MigrationInterface {
  name = "CreateRedevelopmentZones1784271000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redevelopment_zones" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL DEFAULT '',
        "region" text NOT NULL DEFAULT '',
        "stage" text NOT NULL DEFAULT '',
        "memo" text,
        "polygon" text NOT NULL,
        "color" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redevelopment_zones"`);
  }
}
