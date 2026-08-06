/**
 * 최종본 웨비나 슬라이드 101~105 시드 (sql.js 로컬 DB 전용).
 * 사용: node scripts/seed-webinar-final-101-105.mjs
 * 이미 존재하는 id는 건너뜁니다(안전 재실행 가능).
 */
import fs from "fs";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const rows = [
  {
    id: "webinar-final_slide-101",
    sortOrder: 100,
    label: "101. 1000만원으로도 수익 (원본 100번과 동일 슬라이드 중복)",
    content: {
      "line1::emphasisText": "1000만원으로도",
      line2: "수익을 내고 있습니다.",
    },
  },
  {
    id: "webinar-final_slide-102",
    sortOrder: 101,
    label: "102. 지방아파트/오피스텔 소액사례 (메모 텍스트)",
    content: {
      body: "## 지방아파트/ 오피스텔 현재 소액 사례 보여주기",
    },
  },
  {
    id: "webinar-final_slide-103",
    sortOrder: 102,
    label: "103. 소득이 없는데 대출이 될까요?",
    content: {
      emoji: "🤔",
      line1: "소득이 없는데",
      line2: "대출이 될까요?",
    },
  },
  {
    id: "webinar-final_slide-104",
    sortOrder: 103,
    label: "104. 경락잔금대출 - 감정가90%/낙찰가80%",
    content: {
      title: "경락잔금대출",
      body: "감정가의 90%<br>낙찰가의 80%",
    },
  },
  {
    id: "webinar-final_slide-105",
    sortOrder: 104,
    label: "105. 경락잔금대출 - 1억낙찰/투자금1000만원",
    content: {
      title: "경락잔금대출",
      body: "1억 낙찰(90%대출)<br><br>투자금 1000만원(10%)",
    },
  },
];

async function main() {
  if (!fs.existsSync(dbPath)) {
    console.error(`로컬 DB 없음: ${dbPath}`);
    process.exit(1);
  }
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const tableCheck = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='lecture_slides'",
  );
  if (!tableCheck.length) {
    console.error("lecture_slides 테이블이 없습니다. API 서버를 먼저 실행하세요.");
    process.exit(1);
  }

  const before = db.exec("SELECT COUNT(*) FROM lecture_slides WHERE deckId = 'webinar-final'");
  console.log(`시드 전 webinar-final 슬라이드 수: ${before[0]?.values[0][0]}`);

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const stmt = db.prepare("SELECT id FROM lecture_slides WHERE id = ? LIMIT 1");
    stmt.bind([row.id]);
    const exists = stmt.step();
    stmt.free();
    if (exists) {
      skipped++;
      continue;
    }

    const now = new Date().toISOString();
    db.run(
      `INSERT INTO lecture_slides (id, deckId, sortOrder, label, content, layout, images, updatedAt)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)`,
      [row.id, "webinar-final", row.sortOrder, row.label, JSON.stringify(row.content), now],
    );
    inserted++;
    console.log(`+ ${row.id}`);
  }

  fs.writeFileSync(dbPath, Buffer.from(db.export()));

  const after = db.exec("SELECT COUNT(*) FROM lecture_slides WHERE deckId = 'webinar-final'");
  console.log(`시드 후 webinar-final 슬라이드 수: ${after[0]?.values[0][0]}`);

  db.close();
  console.log(`\n완료: ${inserted}건 추가, ${skipped}건 건너뜀`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
