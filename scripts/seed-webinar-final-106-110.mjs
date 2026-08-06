/**
 * 최종본 웨비나 슬라이드 106~110 시드 (sql.js 로컬 DB 전용).
 * 사용: node scripts/seed-webinar-final-106-110.mjs
 * 이미 존재하는 id는 건너뜁니다(안전 재실행 가능).
 */
import fs from "fs";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const rows = [
  {
    id: "webinar-final_slide-106",
    sortOrder: 105,
    label: "106. 대출/세금 상담 및 전문가 연결",
    content: { body: "대출/세금 상담<br>+<br>대출/세금 전문가 연결" },
  },
  {
    id: "webinar-final_slide-107",
    sortOrder: 106,
    label: "107. 50대 어머님 낙찰 사례",
    content: {
      title: "50대 어머님",
      loanInfo: "낙찰: 1.7억<br>대출: 1.5억(90%)",
      "investment::prefix": "투자:",
      "investment::highlight": "2천(10%)",
      sale: "매도: 2.8억",
      "profit::prefix": "차익:",
      "profit::highlight": "1.1억",
    },
  },
  {
    id: "webinar-final_slide-108",
    sortOrder: 107,
    label: "108. 소득이 없어도 가능한 경락잔금대출",
    content: {
      title: "경락잔금대출",
      line1: "소득이 없어도 가능합니다!",
      line2: "(은퇴후 소득이 없는 아버님)",
    },
  },
  {
    id: "webinar-final_slide-109",
    sortOrder: 108,
    label: "109. 경매 너무 어렵고 힘든 거 아니야?",
    content: {
      "line1::emphasisText": "경매",
      "line1::suffix": "너무 어렵고",
      line2: "힘든거 아니야?",
      "footer::prefix": "여러분이",
      "footer::emphasisText": "생각하는",
      "footer::suffix": "경매",
    },
  },
  {
    id: "webinar-final_slide-110",
    sortOrder: 109,
    label: "110. 전체 경매 물건과 특수 물건 비교",
    content: {
      leftTitle: "총 경매 물건(주거용)",
      rightTitle: "특수 물건 제외(주거용)",
      note: "(10%이하)",
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
