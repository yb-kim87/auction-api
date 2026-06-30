/**
 * 운영 API(승인된 물건) → 로컬 DB import
 * 사용: npm run sync:from-production
 * 필요: auction-api가 localhost:3001 에서 실행 중
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const DRY_RUN = process.argv.includes("--dry-run");

const productionBase = (
  process.env.PRODUCTION_API_URL?.trim() ||
  "https://auction-production-2c72.up.railway.app"
).replace(/\/$/, "");

const localBase = (
  process.env.LOCAL_API_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT?.trim() || "3001"}`
).replace(/\/$/, "");

const secret = process.env.CRAWLER_SECRET?.trim() || "local-crawler-secret";

const PICK_FIELDS = [
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
  const payload = { submittedBy: "production-sync" };
  for (const key of PICK_FIELDS) {
    if (row[key] !== undefined && row[key] !== null) {
      payload[key] = row[key];
    }
  }
  return payload;
}

async function main() {
  const fetchUrl = `${productionBase}/auctions`;
  const importUrl = `${localBase}/crawler/import-item`;

  console.log(`운영에서 가져오기: ${fetchUrl}`);
  const listRes = await fetch(fetchUrl);
  if (!listRes.ok) {
    throw new Error(`운영 API 실패 HTTP ${listRes.status}: ${await listRes.text()}`);
  }

  const rows = await listRes.json();
  if (!Array.isArray(rows)) {
    throw new Error("운영 API 응답 형식이 올바르지 않습니다.");
  }

  console.log(`운영 승인 물건: ${rows.length}건`);
  console.log(`로컬 적재: ${importUrl}`);
  if (DRY_RUN) {
    console.log(
      "(dry-run) 샘플:",
      rows.slice(0, 3).map((r) => r.auctionNo),
    );
    return;
  }

  const health = await fetch(`${localBase}/auctions`).catch(() => null);
  if (!health?.ok) {
    console.error(
      "로컬 API(3001)에 연결할 수 없습니다. auction-api에서 npm run start:dev 를 실행해 주세요.",
    );
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const payload = pickPayload(row);
    const label = payload.auctionNo || payload.address || "?";

    try {
      const res = await fetch(importUrl, {
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
        const reason = body.reason ? ` (${body.reason})` : "";
        console.log(`[스킵] ${label}${reason}`);
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

  const after = await fetch(`${localBase}/auctions`);
  const localRows = after.ok ? await after.json() : [];
  console.log("\n완료:", {
    created,
    updated,
    skipped,
    failed,
    source: rows.length,
    localApproved: Array.isArray(localRows) ? localRows.length : "?",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
