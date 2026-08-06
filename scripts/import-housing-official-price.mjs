/**
 * 국토교통부_주택 공시가격 정보(data.go.kr 3073746) 연 1회 CSV 배치를
 * housing_official_price 테이블에 직접 벌크 적재한다.
 *
 * 1,500만 행 이상의 대용량이라 NestJS API(HTTP JSON)를 거치지 않고
 * DATABASE_PUBLIC_URL로 Postgres에 직접 다중행 INSERT한다(2026-08-06).
 *
 * 사용: node scripts/import-housing-official-price.mjs "<csv경로>" [--dry-run] [--limit=N]
 *
 * 컬럼(2025년분 실제 헤더, 확인 완료):
 *   기준연도,기준월,법정동코드,도로명주소,시도,시군구,읍면,동리,특수지코드,
 *   본번,부번,특수지명,단지명,동명,호명,전용면적,공시가격,단지코드,동코드,
 *   호코드,건축물대장PK
 */
import { createReadStream } from "fs";
import readline from "readline";
import pg from "pg";

const { Client } = pg;

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("사용법: node import-housing-official-price.mjs <csv경로> [--dry-run] [--limit=N]");
  process.exit(1);
}
const DRY_RUN = process.argv.includes("--dry-run");
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const BATCH_SIZE = Number(process.env.IMPORT_BATCH_SIZE || 1000);

const DATABASE_URL = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
if (!DRY_RUN && !DATABASE_URL) {
  console.error("DATABASE_PUBLIC_URL(또는 DATABASE_URL) 환경변수가 필요합니다.");
  process.exit(1);
}

/** 간단한 CSV 한 줄 파서 — 필드가 전부 큰따옴표로 감싸져 있고, 내부에
 * 이스케이프된 큰따옴표(""가 리터럴 ")가 있을 수 있다고 가정한다. */
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

const HEADER_INDEX = {
  stdYear: "기준연도",
  bjdongFull: "법정동코드",
  complexNm: "단지명",
  dongNm: "동명",
  hoNm: "호명",
  exclusiveArea: "전용면적",
  postedPrice: "공시가격",
  mainBun: "본번",
  subBun: "부번",
  housingLedgerPk: "건축물대장PK",
};

function toIntOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toFloatOrNull(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  // DB 연결을 먼저 맺고 나서 CSV 스트림을 연다 — 순서를 반대로 하면(스트림을
  // 먼저 만들고 나서 connect) 이 환경(Windows/git-bash)에서 connect()가
  // 응답 없이 멈춘다(실측, 2026-08-06). 원인은 특정하지 못했으나(추정:
  // 파일 스트림 오픈과 TLS 핸드셰이크가 겹칠 때의 이벤트루프/스레드풀
  // 경합), 이 순서로 하면 항상 정상 동작한다.
  const client = DRY_RUN ? null : new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  if (client) await client.connect();

  const stream = createReadStream(csvPath, { encoding: "utf8" });
  stream.on("error", (e) => {
    console.error(`CSV 파일을 열 수 없습니다: ${e.message}`);
    process.exit(1);
  });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let header = null;
  let colIdx = {};
  let rows = [];
  let total = 0;
  let skipped = 0;
  let inserted = 0;
  const t0 = Date.now();

  async function flush() {
    if (rows.length === 0) return;
    if (DRY_RUN) {
      rows = [];
      return;
    }
    const cols = [
      "housingLedgerPk",
      "sigunguCd",
      "bjdongCd",
      "mainBun",
      "subBun",
      "complexNm",
      "dongNm",
      "hoNm",
      "exclusiveArea",
      "postedPrice",
      "stdYear",
      "importedAt",
    ];
    const values = [];
    const placeholders = rows.map((r, i) => {
      const base = i * cols.length;
      values.push(
        r.housingLedgerPk,
        r.sigunguCd,
        r.bjdongCd,
        r.mainBun,
        r.subBun,
        r.complexNm,
        r.dongNm,
        r.hoNm,
        r.exclusiveArea,
        r.postedPrice,
        r.stdYear,
        r.importedAt,
      );
      return `(${cols.map((_, j) => `$${base + j + 1}`).join(",")})`;
    });
    const sql = `
      INSERT INTO housing_official_price (${cols.map((c) => `"${c}"`).join(",")})
      VALUES ${placeholders.join(",")}
      ON CONFLICT ("housingLedgerPk", "hoNm", "stdYear")
      WHERE "housingLedgerPk" IS NOT NULL
      DO UPDATE SET
        "sigunguCd" = EXCLUDED."sigunguCd",
        "bjdongCd" = EXCLUDED."bjdongCd",
        "mainBun" = EXCLUDED."mainBun",
        "subBun" = EXCLUDED."subBun",
        "complexNm" = EXCLUDED."complexNm",
        "exclusiveArea" = EXCLUDED."exclusiveArea",
        "postedPrice" = EXCLUDED."postedPrice",
        "importedAt" = EXCLUDED."importedAt"
    `;
    await client.query(sql, values);
    inserted += rows.length;
    rows = [];
  }

  const importedAt = new Date().toISOString();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const fields = parseCsvLine(line);
    if (!header) {
      header = fields;
      header.forEach((h, i) => {
        colIdx[h] = i;
      });
      const missing = Object.values(HEADER_INDEX).filter((h) => !(h in colIdx));
      if (missing.length) {
        console.error("헤더 매칭 실패:", missing, "\n실제 헤더:", header);
        process.exit(1);
      }
      console.error("헤더 확인 완료:", HEADER_INDEX);
      continue;
    }

    total++;
    if (total > LIMIT) break;

    const get = (key) => fields[colIdx[HEADER_INDEX[key]]];
    const postedPrice = toIntOrNull(get("postedPrice"));
    const stdYear = String(get("stdYear") ?? "").trim();
    const hoNm = String(get("hoNm") ?? "").trim();
    const bjdongFull = String(get("bjdongFull") ?? "").trim();
    const pk = String(get("housingLedgerPk") ?? "").trim();

    if (postedPrice == null || !stdYear || !hoNm) {
      skipped++;
      continue;
    }

    rows.push({
      housingLedgerPk: pk || null,
      sigunguCd: bjdongFull.slice(0, 5),
      bjdongCd: bjdongFull.slice(5, 10),
      mainBun: String(get("mainBun") ?? "").trim(),
      subBun: String(get("subBun") ?? "").trim(),
      complexNm: String(get("complexNm") ?? "").trim() || null,
      dongNm: String(get("dongNm") ?? "").trim(),
      hoNm,
      exclusiveArea: toFloatOrNull(get("exclusiveArea")),
      postedPrice,
      stdYear,
      importedAt,
    });

    if (rows.length >= BATCH_SIZE) {
      await flush();
      if (total % 100000 === 0) {
        const sec = (Date.now() - t0) / 1000;
        console.error(
          `  ${total.toLocaleString()}행 처리 (적재 ${inserted.toLocaleString()}, 건너뜀 ${skipped.toLocaleString()}, ${sec.toFixed(0)}s, ${(total / sec).toFixed(0)}행/s)`,
        );
      }
    }
  }
  await flush();
  if (client) await client.end();

  console.error(
    `\n완료 — 전체 ${total.toLocaleString()}행, 적재 ${inserted.toLocaleString()}건, 건너뜀 ${skipped.toLocaleString()}건, ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
