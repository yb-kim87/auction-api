import { config as loadEnv } from "dotenv";
import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

const callbackUrl =
  process.env.CRAWLER_CALLBACK_URL?.trim() ||
  (process.env.PRODUCTION_API_URL
    ? `${process.env.PRODUCTION_API_URL.replace(/\/$/, "")}/crawler/import-item`
    : "");

const secret = process.env.CRAWLER_SECRET?.trim() || "local-crawler-secret";

const SYNC_FIELDS = [
  "memo",
  "link",
  "views",
  "auctionNo",
  "address",
  "totalUnits",
  "usage",
  "area",
  "builtYear",
  "bidDate",
  "appraisedValue",
  "minPrice",
  "salePrice",
  "naverPrice",
  "naverId",
  "diffNaverSale",
  "diffNaverMin",
  "diffNaverAppraised",
  "elevator",
  "parking",
  "landShare",
  "buildingRegistry",
  "education",
  "tradingCount",
  "bidInfo",
  "owner",
  "appraiser",
  "officialLandPrice",
  "tenantInfo",
  "specialNote",
  "tenantDetail",
  "priceDetail",
  "tradingDetail",
  "recordTime",
];

function pickPayload(row) {
  const payload = { submittedBy: "local-sync" };
  for (const key of SYNC_FIELDS) {
    if (row[key] !== undefined && row[key] !== null) {
      payload[key] = row[key];
    }
  }
  return payload;
}

async function main() {
  if (!callbackUrl) {
    console.error(
      "CRAWLER_CALLBACK_URL 또는 PRODUCTION_API_URL 환경변수가 필요합니다.",
    );
    console.error(
      "예: PRODUCTION_API_URL=https://auction-production-2c72.up.railway.app",
    );
    process.exit(1);
  }

  const dbPath = path.join(root, "data", "auction.db");
  if (!fs.existsSync(dbPath)) {
    console.error(`로컬 DB 없음: ${dbPath}`);
    process.exit(1);
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const result = db.exec(
    "SELECT * FROM auctions WHERE status = 'approved' ORDER BY auctionNo",
  );

  if (!result.length) {
    console.log("동기화할 approved 물건이 없습니다.");
    return;
  }

  const columns = result[0].columns;
  const rows = result[0].values.map((values) => {
    const row = {};
    columns.forEach((col, index) => {
      row[col] = values[index];
    });
    return row;
  });

  console.log(`대상: ${rows.length}건 → ${callbackUrl}`);
  if (DRY_RUN) {
    console.log("(dry-run) 첫 3건:", rows.slice(0, 3).map((r) => r.auctionNo));
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = pickPayload(row);
    const label = payload.auctionNo || payload.address || "?";

    try {
      const res = await fetch(callbackUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Crawler-Secret": secret,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        console.error(`[실패] ${label} HTTP ${res.status}: ${text.slice(0, 120)}`);
        failed += 1;
        continue;
      }

      const body = await res.json();
      if (body.skipped) {
        skipped += 1;
        console.log(`[스킵] ${label}${body.unchanged ? " (변경 없음)" : ""}`);
      } else if (body.created) {
        created += 1;
        console.log(`[등록] ${label}`);
      } else {
        updated += 1;
        console.log(`[갱신] ${label}`);
      }
    } catch (err) {
      console.error(`[오류] ${label}:`, err instanceof Error ? err.message : err);
      failed += 1;
    }
  }

  console.log("\n완료:", { created, updated, skipped, failed, total: rows.length });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
