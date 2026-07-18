import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKnowledgeCategories1784222000000 implements MigrationInterface {
  name = "AddKnowledgeCategories1784222000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "knowledge_categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name" text NOT NULL,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_knowledge_categories_name" UNIQUE ("name")
      )
    `);
    // 기존에 이미 지식 항목에서 쓰이고 있는 분류값들을 씨앗으로 넣어둔다.
    await queryRunner.query(`
      INSERT INTO "knowledge_categories" ("name", "sortOrder")
      SELECT DISTINCT trim("category"), 0
      FROM "auction_knowledge"
      WHERE trim("category") != ''
      ON CONFLICT ("name") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "knowledge_categories" ("name", "sortOrder")
      VALUES ('권리분석', 0), ('물건추천', 1)
      ON CONFLICT ("name") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "knowledge_categories"`);
  }
}
