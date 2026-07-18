import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKnowledgeGrade1784223000000 implements MigrationInterface {
  name = "AddKnowledgeGrade1784223000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "auction_knowledge"
      ADD COLUMN IF NOT EXISTS "grade" integer NOT NULL DEFAULT 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auction_knowledge" DROP COLUMN IF EXISTS "grade"`);
  }
}
