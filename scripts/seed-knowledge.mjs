/**
 * 경매지식 샘플 데이터 적재
 * 사용: npm run seed:knowledge
 * 이미 같은 제목이 있으면 건너뜁니다.
 */
import { config as loadEnv } from "dotenv";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import initSqlJs from "sql.js";
import pg from "pg";
import { KNOWLEDGE_SEED_SAMPLES } from "./knowledge-seed-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const { Client } = pg;

async function seedSqlJs() {
  const dbPath = path.join(root, "data", "auction.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`로컬 DB 없음: ${dbPath}`);
    console.error("먼저 API 서버를 한 번 실행해 DB를 생성하세요.");
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const tableCheck = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='auction_knowledge'",
  );
  if (!tableCheck.length) {
    console.error("auction_knowledge 테이블이 없습니다. API 서버를 먼저 실행하세요.");
    process.exit(1);
  }

  let inserted = 0;
  let skipped = 0;

  for (const item of KNOWLEDGE_SEED_SAMPLES) {
    const stmt = db.prepare(
      "SELECT id FROM auction_knowledge WHERE title = ? LIMIT 1",
    );
    stmt.bind([item.title]);
    const exists = stmt.step();
    stmt.free();
    if (exists) {
      skipped++;
      continue;
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO auction_knowledge (id, title, category, tags, content, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [id, item.title, item.category, item.tags, item.content, now, now],
    );
    inserted++;
    console.log(`+ ${item.title}`);
  }

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
  console.log(`\n완료: ${inserted}건 추가, ${skipped}건 건너뜀 (sql.js)`);
}

async function seedPostgres(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    ssl:
      process.env.PGSSL === "false"
        ? false
        : { rejectUnauthorized: false },
  });
  await client.connect();

  let inserted = 0;
  let skipped = 0;

  for (const item of KNOWLEDGE_SEED_SAMPLES) {
    const { rows } = await client.query(
      "SELECT id FROM auction_knowledge WHERE title = $1 LIMIT 1",
      [item.title],
    );
    if (rows.length) {
      skipped++;
      continue;
    }

    const id = randomUUID();
    await client.query(
      `INSERT INTO auction_knowledge (id, title, category, tags, content, active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW())`,
      [id, item.title, item.category, item.tags, item.content],
    );
    inserted++;
    console.log(`+ ${item.title}`);
  }

  await client.end();
  console.log(`\n완료: ${inserted}건 추가, ${skipped}건 건너뜀 (PostgreSQL)`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    await seedPostgres(databaseUrl);
  } else {
    await seedSqlJs();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
