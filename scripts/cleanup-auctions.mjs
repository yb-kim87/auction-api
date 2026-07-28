/**
 * 쓰레기 물건 삭제 + 동일 사건(경매번호) 중복 병합
 * 사용: npm run cleanup:production [-- --dry-run]
 *      npm run cleanup:local [-- --dry-run]
 */
import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: path.join(root, ".env") });

const DRY_RUN = process.argv.includes("--dry-run");
const USE_LOCAL = process.argv.includes("--local");

const INVALID_AUCTION_NO_HINTS = [
  /MY위젯/i,
  /도움말/,
  /위젯/,
  /로그아웃/,
  /로그인/,
  /님\s*MY/i,
];

function normalizeCrawlAuctionNo(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/\s/g, "");
  const taMatch = compact.match(/^(\d{4})타경(\d+)(?:\((\d+)\))?$/);
  if (taMatch) {
    const [, year, serial, pn] = taMatch;
    return pn ? `${year}타경${serial}(${pn})` : `${year}타경${serial}`;
  }
  const embedded = compact.match(/(\d{4})타경(\d+)(?:\((\d+)\))?/);
  if (embedded) {
    const [, year, serial, pn] = embedded;
    return pn ? `${year}타경${serial}(${pn})` : `${year}타경${serial}`;
  }
  const dashMatch = trimmed.match(/(\d{4})\s*-\s*(\d+)/);
  if (dashMatch) return `${dashMatch[1]}타경${dashMatch[2]}`;
  if (/^\d{4}타경\d+(?:\(\d+\))?$/.test(compact)) return compact;
  return null;
}

function isJunk(item) {
  const raw = String(item.auctionNo ?? "").trim();
  for (const hint of INVALID_AUCTION_NO_HINTS) {
    if (hint.test(raw)) return true;
  }
  if (!normalizeCrawlAuctionNo(raw)) return true;
  const address = String(item.address ?? "").trim();
  if (!address || address === "없음" || address === "값없음") return true;
  return false;
}

function keeperScore(item) {
  let score = 0;
  for (const key of [
    "address",
    "buildingRegistry",
    "tenantDetail",
    "education",
    "rawContent",
    "memo",
  ]) {
    score += String(item[key] ?? "").length;
  }
  if (item.updatedAt) score += 1_000_000;
  if (item.createdAt) score += new Date(item.createdAt).getTime() / 1e10;
  if (item.recordTime) score += 100;
  return score;
}

function adminHeaders() {
  const user = process.env.ADMIN_USER?.trim() || "admin";
  const role = "admin";
  return {
    "Content-Type": "application/json",
    "X-Auction-User": user,
    "X-Auction-Role": role,
  };
}

async function main() {
  const base = (
    USE_LOCAL
      ? `http://127.0.0.1:${process.env.PORT?.trim() || "3001"}`
      : process.env.PRODUCTION_API_URL?.trim() ||
        "https://auction-production-2c72.up.railway.app"
  ).replace(/\/$/, "");

  console.log(`대상 API: ${base}${DRY_RUN ? " (dry-run)" : ""}`);

  const items = [];
  let page = 1;
  let totalPages = 1;
  do {
    const listRes = await fetch(
      `${base}/auctions/manage?page=${page}&pageSize=100`,
      { headers: adminHeaders() },
    );
    if (!listRes.ok) {
      throw new Error(
        `목록 조회 실패 HTTP ${listRes.status}: ${await listRes.text()}`,
      );
    }

    const payload = await listRes.json();
    if (!Array.isArray(payload.items)) {
      throw new Error("목록 응답 형식이 올바르지 않습니다.");
    }
    items.push(...payload.items);
    totalPages = payload.totalPages;
    page += 1;
  } while (page <= totalPages);

  console.log(`전체 ${items.length}건 검사`);

  const junkIds = [];
  const valid = [];

  for (const item of items) {
    if (isJunk(item)) {
      junkIds.push(item.id);
      console.log(`[쓰레기] ${JSON.stringify(item.auctionNo)} (${item.id.slice(0, 8)})`);
    } else {
      valid.push(item);
    }
  }

  const groups = new Map();
  for (const item of valid) {
    const key = normalizeCrawlAuctionNo(item.auctionNo);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const duplicateDeleteIds = [];
  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    group.sort((a, b) => keeperScore(b) - keeperScore(a));
    const keeper = group[0];
    const losers = group.slice(1);
    console.log(
      `[중복] ${key} — 유지: ${keeper.auctionNo}, 삭제 ${losers.length}건: ${losers.map((x) => x.auctionNo).join(", ")}`,
    );
    for (const loser of losers) {
      duplicateDeleteIds.push(loser.id);
    }
  }

  const deleteIds = [...new Set([...junkIds, ...duplicateDeleteIds])];
  console.log(
    `\n삭제 예정: ${deleteIds.length}건 (쓰레기 ${junkIds.length}, 중복 ${duplicateDeleteIds.length})`,
  );
  console.log(`유지 예상: ${items.length - deleteIds.length}건`);

  if (DRY_RUN || deleteIds.length === 0) {
    return;
  }

  const CHUNK = 50;
  let deleted = 0;
  for (let i = 0; i < deleteIds.length; i += CHUNK) {
    const chunk = deleteIds.slice(i, i + CHUNK);
    const res = await fetch(`${base}/auctions/delete-many`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ ids: chunk }),
    });
    if (!res.ok) {
      throw new Error(
        `삭제 실패 HTTP ${res.status}: ${await res.text()}`,
      );
    }
    const body = await res.json();
    deleted += body.deleted ?? chunk.length;
  }

  const afterRes = await fetch(`${base}/auctions`);
  const after = afterRes.ok ? await afterRes.json() : [];
  console.log("\n완료:", {
    deleted,
    approvedRemaining: Array.isArray(after) ? after.length : "?",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
