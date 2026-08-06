/**
 * 최종본 웨비나 슬라이드 91~100 시드 (sql.js 로컬 DB 전용).
 * 사용: node scripts/seed-webinar-final-91-100.mjs
 * 이미 존재하는 id는 건너뜁니다(안전 재실행 가능).
 */
import fs from "fs";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const rows = [
  {
    id: "webinar-final_slide-91",
    sortOrder: 90,
    label: "91. 이제는 임장 부탁하세요 - 당근/해주세요",
    content: {
      "line1::prefix": "이제는",
      "line1::emphasisText": "임장",
      "line1::suffix": "부탁하세요",
      line2: "당근/해주세요",
      cardTitle: "🙂 해주세요 · www.pleasehelp.co.kr",
      cardSubtitle: "해주세요",
      cardBody: "중개 수수료 0% 포장 수수료 0% 심부름앱 '해주세요'가 음식 배달을 시작합니다!",
    },
  },
  {
    id: "webinar-final_slide-92",
    sortOrder: 91,
    label: "92. 카카오톡 대화 예시 (해주세요)",
    content: {},
  },
  {
    id: "webinar-final_slide-93",
    sortOrder: 92,
    label: "93. 낙찰 후 청소/인테리어 부탁하세요 - 당근/해주세요",
    content: {
      "line1::prefix": "낙찰 후",
      "line1::emphasisText": "청소/인테리어",
      line2: "당근/해주세요",
      cardTitle: "🥕 당근 · www.daangn.com",
      cardSubtitle: "당신 근처의 당근",
      cardBody: "알바/과외 · 오창읍 · 동네생활 · 중고차 · 모임 · 동네업체",
    },
  },
  {
    id: "webinar-final_slide-94",
    sortOrder: 93,
    label: "94. 카카오톡 대화 예시 (청소/인테리어)",
    content: {},
  },
  {
    id: "webinar-final_slide-95",
    sortOrder: 94,
    label: "95. 낙찰 후 명도 부탁하세요 - 당근/해주세요",
    content: {
      "line1::prefix": "낙찰 후",
      "line1::emphasisText": "명도",
      line2: "당근/해주세요",
      cardTitle: "🥕 당근 · www.daangn.com",
      cardSubtitle: "당신 근처의 당근",
      cardBody: "알바/과외 · 오창읍 · 동네생활 · 중고차 · 모임 · 동네업체",
    },
  },
  {
    id: "webinar-final_slide-96",
    sortOrder: 95,
    label: "96. 카카오톡 대화 / 편지 예시 (명도)",
    content: {},
  },
  {
    id: "webinar-final_slide-97",
    sortOrder: 96,
    label: "97. 낙찰 후 매도 부탁하세요 - 네이버 부동산",
    content: {
      "line1::prefix": "낙찰 후",
      "line1::emphasisText": "매도",
      line2: "네이버 부동산",
    },
  },
  {
    id: "webinar-final_slide-98",
    sortOrder: 97,
    label: "98. 돈많은 사람만 하는거 아니야?",
    content: {
      "line1::emphasisText": "돈많은",
      "line1::suffix": "사람만",
      line2: "하는거 아니야?",
    },
  },
  {
    id: "webinar-final_slide-99",
    sortOrder: 98,
    label: "99. 수강생 성과 모음",
    content: {
      headerTitle: "수강생 성과 모음",
      card1_label: "비규제빌라",
      card1_info: "시세: 1.9억<br>낙찰: 1.38억(대출90%)",
      card1_highlight: "투자 : 1.4천 / 수익: 5천",
      card2_label: "비규제빌라(1주택자)",
      card2_info: "시세: 1.4억<br>낙찰: 1억(대출80%)",
      card2_highlight: "투자 : 2천 / 수익: 4천",
      card3_label: "다세대주택",
      card3_info: "시세: 2.8억<br>낙찰: 1.7억(대출90%)",
      card3_highlight: "투자: 2천 / 수익: 1억",
      card4_label: "비규제아파트",
      card4_info: "시세: 3.4억<br>낙찰: 2.8억(대출90%)",
      card4_highlight: "투자 : 3천 / 수익: 6천",
      card5_label: "비규제아파트(무주택)",
      card5_info: "시세: 4억<br>낙찰: 3.3억(대출90%)",
      card5_highlight: "투자 : 3.3천 / 수익: 7천",
    },
  },
  {
    id: "webinar-final_slide-100",
    sortOrder: 99,
    label: "100. 1000만원으로도 수익을 내고 있습니다.",
    content: {
      "line1::emphasisText": "1000만원으로도",
      line2: "수익을 내고 있습니다.",
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
