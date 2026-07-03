import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserItemActions1751700000000 implements MigrationInterface {
  name = "AddUserItemActions1751700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "user_item_actions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" character varying NOT NULL,
        "itemId" character varying NOT NULL,
        "actionType" character varying NOT NULL,
        "durationSeconds" integer,
        "metadata" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_item_actions_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_item_actions_user_item" ON "user_item_actions" ("userId", "itemId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_item_actions_action_type" ON "user_item_actions" ("actionType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_item_actions"`);
  }
}
