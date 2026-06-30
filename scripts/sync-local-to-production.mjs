/**
 * 로컬 auction.db → Railway 운영 DB 동기화
 * - approved 경매 물건
 * - auction_knowledge
 * - knowledge_drafts (structured / approved / skipped)
 *
 * 사용: npm run sync:production:all
 * 필요: PRODUCTION_API_URL, CRAWLER_SECRET (경매·지식 API)
 * 선택: PRODUCTION_DATABASE_URL — API sync 엔드포인트가 없을 때 Postgres 직접 적재
 */
import { config as loadEnv } from "dotenv";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import initSqlJs from "sql.js";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_AUCTIONS = process.argv.includes("--skip-auctions");
const SKIP_KNOWLEDGE = process.argv.includes("--skip-knowledge");

const productionBase = (
  process.env.PRODUCTION_API_URL?.trim() ||
  "https://auction-production-2c72.up.railway.app"
).replace(/\/$/, "");

const callbackUrl =
  process.env.CRAWLER_CALLBACK_URL?.trim() ||
  `${productionBase}/crawler/import-item`;

const secret = process.env.CRAWLER_SECRET?.trim() || "local-crawler-secret";
const pgUrl =
  process.env.PRODUCTION_DATABASE_URL?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "";

const { Client } = pg;

const AUCTION_FIELDS = [
  "memo", "link", "views", "auctionNo", "address", "totalUnits", "usage", "area",
  "builtYear", "bidDate", "appraisedValue", "minPrice", "salePrice", "naverPrice",
  "naverId", "diffNaverSale", "diffNaverMin", "diffNaverAppraised", "elevator",
  "parking", "landShare", "buildingRegistry", "education", "tradingCount", "bidInfo",
  "owner", "appraiser", "officialLandPrice", "tenantInfo", "specialNote",
  "tenantDetail", "priceDetail", "tradingDetail", "recordTime",
];

function pickAuction(row) {
  const payload = { submittedBy: "local-sync" };
  for (const key of AUCTION_FIELDS) {
    if (row[key] !== undefined && row[key] !== null) payload[key] = row[key];
  }
  return payload;
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Crawler-Secret": secret,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function syncAuctions(rows) {
  console.log(`\n[경매] ${rows.length}건 → ${callbackUrl}`);
  if (DRY_RUN) return { created: 0, updated: 0, skipped: rows.length, failed: 0 };

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = pickAuction(row);
    const label = payload.auctionNo || payload.address || "?";
    try {
      const { ok, status, body } = await postJson(callbackUrl, payload);
      if (!ok) {
        console.error(`  [실패] ${label} HTTP ${status}`);
        failed += 1;
        continue;
      }
      if (body.skipped) {
        skipped += 1;
      } else if (body.created) {
        created += 1;
      } else {
        updated += 1;
      }
    } catch (err) {
      console.error(`  [오류] ${label}:`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }
  console.log("[경매] 완료:", { created, updated, skipped, failed });
  return { created, updated, skipped, failed };
}

async function syncKnowledgeViaApi(knowledgeRows, draftRows) {
  console.log(`\n[지식] API → ${productionBase}`);

  let kCreated = 0;
  let kUpdated = 0;
  let kFailed = 0;
  let dCreated = 0;
  let dUpdated = 0;
  let dFailed = 0;

  for (const row of knowledgeRows) {
    const payload = {
      id: row.id,
      title: row.title,
      category: row.category,
      tags: row.tags,
      content: row.content,
      active: row.active === 1 || row.active === true,
    };
    if (DRY_RUN) continue;
    const { ok, status } = await postJson(`${productionBase}/crawler/sync/knowledge`, payload);
    if (!ok) {
      if (status === 404) return { unsupported: true };
      kFailed += 1;
      continue;
    }
    kCreated += 1;
  }

  for (const row of draftRows) {
    const payload = {
      sourceArticleId: row.sourceArticleId,
      sourceUrl: row.sourceUrl,
      sourceTitle: row.sourceTitle,
      sourceBoard: row.sourceBoard,
      cafeUrl: row.cafeUrl,
      rawContent: row.rawContent,
      title: row.title,
      category: row.category,
      tags: row.tags,
      content: row.content,
      aiNote: row.aiNote,
      status: row.status,
      errorMessage: row.errorMessage,
    };
    if (DRY_RUN) continue;
    const { ok, status, body } = await postJson(
      `${productionBase}/crawler/sync/knowledge-draft`,
      payload,
    );
    if (!ok) {
      if (status === 404) return { unsupported: true };
      dFailed += 1;
      console.error(`  [초안 실패] ${row.sourceArticleId} HTTP ${status}`);
      continue;
    }
    if (body.created) dCreated += 1;
    else dUpdated += 1;
  }

  console.log("[지식] 완료:", {
    knowledge: { created: kCreated, failed: kFailed },
    drafts: { created: dCreated, updated: dUpdated, failed: dFailed },
  });
  return { unsupported: false, kCreated, dUpdated, dCreated, dFailed, kFailed };
}

async function syncKnowledgeViaPg(knowledgeRows, draftRows) {
  if (!pgUrl) {
    console.error(
      "운영 API에 sync 엔드포인트가 없습니다. PRODUCTION_DATABASE_URL을 .env에 추가해 주세요.",
    );
    return { ok: false };
  }

  console.log(`\n[지식] PostgreSQL 직접 적재 (${draftRows.length} 초안, ${knowledgeRows.length} 지식)`);
  if (DRY_RUN) return { ok: true };

  const client = new Client({
    connectionString: pgUrl,
    ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  let dUpsert = 0;
  for (const row of draftRows) {
    await client.query(
      `INSERT INTO knowledge_drafts (
        id, "sourceArticleId", "sourceUrl", "sourceTitle", "sourceBoard", "cafeUrl",
        "rawContent", title, category, tags, content, "aiNote", status, "errorMessage",
        "createdAt", "updatedAt"
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      ON CONFLICT ("sourceArticleId") DO UPDATE SET
        "sourceUrl"=EXCLUDED."sourceUrl",
        "sourceTitle"=EXCLUDED."sourceTitle",
        "sourceBoard"=EXCLUDED."sourceBoard",
        "cafeUrl"=EXCLUDED."cafeUrl",
        "rawContent"=EXCLUDED."rawContent",
        title=EXCLUDED.title,
        category=EXCLUDED.category,
        tags=EXCLUDED.tags,
        content=EXCLUDED.content,
        "aiNote"=EXCLUDED."aiNote",
        status=EXCLUDED.status,
        "errorMessage"=EXCLUDED."errorMessage",
        "updatedAt"=EXCLUDED."updatedAt"`,
      [
        row.id || randomUUID(),
        row.sourceArticleId,
        row.sourceUrl,
        row.sourceTitle ?? "",
        row.sourceBoard ?? "",
        row.cafeUrl ?? "",
        row.rawContent ?? "",
        row.title ?? "",
        row.category ?? "",
        row.tags ?? "",
        row.content ?? "",
        row.aiNote ?? "",
        row.status ?? "structured",
        row.errorMessage ?? null,
        row.createdAt ?? new Date().toISOString(),
        row.updatedAt ?? new Date().toISOString(),
      ],
    );
    dUpsert += 1;
  }

  let kUpsert = 0;
  for (const row of knowledgeRows) {
    const existing = await client.query(
      "SELECT id FROM auction_knowledge WHERE title = $1 LIMIT 1",
      [row.title],
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE auction_knowledge SET category=$2, tags=$3, content=$4, active=$5, "updatedAt"=NOW()
         WHERE id=$1`,
        [
          existing.rows[0].id,
          row.category ?? "",
          row.tags ?? "",
          row.content ?? "",
          row.active === 1 || row.active === true,
        ],
      );
    } else {
      await client.query(
        `INSERT INTO auction_knowledge (id, title, category, tags, content, active, "createdAt", "updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
        [
          row.id || randomUUID(),
          row.title,
          row.category ?? "",
          row.tags ?? "",
          row.content ?? "",
          row.active === 1 || row.active === true,
        ],
      );
    }
    kUpsert += 1;
  }

  await client.end();
  console.log("[지식] Postgres 완료:", { drafts: dUpsert, knowledge: kUpsert });
  return { ok: true };
}

function rowsFromExec(db, sql) {
  const result = db.exec(sql);
  if (!result.length) return [];
  const columns = result[0].columns;
  return result[0].values.map((values) => {
    const row = {};
    columns.forEach((col, index) => {
      row[col] = values[index];
    });
    return row;
  });
}

async function main() {
  const dbPath = path.join(root, "data", "auction.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`로컬 DB 없음: ${dbPath}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const auctions = rowsFromExec(
    db,
    "SELECT * FROM auctions WHERE status = 'approved' ORDER BY auctionNo",
  );
  const knowledge = rowsFromExec(db, "SELECT * FROM auction_knowledge ORDER BY title");
  const drafts = rowsFromExec(
    db,
    `SELECT * FROM knowledge_drafts
     WHERE status IN ('structured','approved','skipped')
     ORDER BY "sourceArticleId"`,
  );

  console.log("로컬 데이터:", {
    auctions: auctions.length,
    knowledge: knowledge.length,
    drafts: drafts.length,
  });
  if (DRY_RUN) console.log("(dry-run)");

  if (!SKIP_AUCTIONS) {
    await syncAuctions(auctions);
  }

  if (!SKIP_KNOWLEDGE) {
    const apiResult = await syncKnowledgeViaApi(knowledge, drafts);
    if (apiResult.unsupported) {
      console.log("운영 API sync 엔드포인트 없음 → Postgres 직접 적재 시도");
      const pgResult = await syncKnowledgeViaPg(knowledge, drafts);
      if (!pgResult.ok) process.exit(1);
    }
  }

  db.close();
  console.log("\n전체 동기화 완료.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
