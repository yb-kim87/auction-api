/**
 * 최종본 웨비나 슬라이드 71~90 시드 (sql.js 로컬 DB 전용).
 * 사용: node seed-webinar-final-71-90.mjs
 * 이미 존재하는 id는 건너뜁니다(안전 재실행 가능).
 */
import fs from "fs";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const rows = [
  { id: "webinar-final_slide-71", sortOrder: 70, label: "71. 그걸 왜 알려주냐?", content: { body: "그걸 왜 알려주냐?" } },
  {
    id: "webinar-final_slide-72",
    sortOrder: 71,
    label: "72. 오늘만큼은 모든걸 알려드리겠습니다!",
    content: {
      headerTitle: "오늘만큼은 모든걸 알려드리겠습니다!",
      "line1::prefix": "원래",
      "line1::suffix": "알려주는거 좋아함",
      note: "(친동생, 친구들, 과외경력, 너무 알려주고 싶음....)",
      "line2::prefix": "어차피",
      "line2::suffix": "넘쳐나는 경매물건",
      "line3::prefix": "알려줘도",
      "line3::suffix": "안해요",
    },
  },
  { id: "webinar-final_slide-73", sortOrder: 72, label: "73. 꼭 도전해 보세요", content: { body: "꼭 도전해 보세요" } },
  {
    id: "webinar-final_slide-74",
    sortOrder: 73,
    label: "74. 그래서 저도 할 수 있을까요?",
    content: { "line::prefix": "그래서", "line::emphasisText": "저도", "line::suffix": "할 수 있을까요?" },
  },
  {
    id: "webinar-final_slide-75",
    sortOrder: 74,
    label: "75. 경매 한다고? 해봤는데 레드오션",
    content: { line1: "경매 한다고?", line2: "해봤는데", line3: "레드오션" },
  },
  {
    id: "webinar-final_slide-76",
    sortOrder: 75,
    label: "76. 대출이 무서워.. 전세 살래.. 청약 기다리고 있어",
    content: {
      "line1::emphasisText": "대출",
      "line1::suffix": "이 무서워..",
      "line2::emphasisText": "전세",
      "line2::suffix": "살래 그냥..",
      "line3::emphasisText": "청약",
      "line3::suffix": "기다리고 있어",
    },
  },
  { id: "webinar-final_slide-77", sortOrder: 76, label: "77. 아 된다고? 나도 알려줘 !!", content: { body: "아 된다고?<br>나도 알려줘 !!" } },
  {
    id: "webinar-final_slide-78",
    sortOrder: 77,
    label: "78. 그래서 저도 할 수 있을까요?(방법은?)",
    content: {
      headerTitle: "그래서 저도 할 수 있을까요?",
      small: "방법은?",
      info: "규제정책인한 두려움 + 방향성",
      highlight: "낮은 경쟁입찰",
    },
  },
  {
    id: "webinar-final_slide-79",
    sortOrder: 78,
    label: "79. 그래서 저도 할 수 있을까요?(연이은 낙찰 소식)",
    content: {
      headerTitle: "그래서 저도 할 수 있을까요?",
      "line::prefix": "연이은",
      "line::emphasisText": "낙찰",
      "line::suffix": "소식",
    },
  },
  { id: "webinar-final_slide-80", sortOrder: 79, label: "80. 여러분도 가능합니다!", content: { body: "여러분도 가능합니다!" } },
  {
    id: "webinar-final_slide-81",
    sortOrder: 80,
    label: "81. 여러분들은 어떠신가요?",
    content: { headerTitle: "여러분들은 어떠신가요?", line1: "5분", line2: "8시 40분" },
  },
  {
    id: "webinar-final_slide-82",
    sortOrder: 81,
    label: "82. 여러분은 과연 무엇을 걱정할까요?",
    content: { line1: "여러분은 과연", "line2::emphasisText": "무엇을", "line2::suffix": "걱정할까요?" },
  },
  {
    id: "webinar-final_slide-83",
    sortOrder: 82,
    label: "83. 경매 시간많은 사람만 하는거 아니야?",
    content: { emoji: "🤔", "line::prefix": "경매", "line::emphasisText": "시간많은", line2: "사람만", line3: "하는거 아니야?" },
  },
  {
    id: "webinar-final_slide-84",
    sortOrder: 83,
    label: "84. 물건조사 임장 하루 4-5시간 포기!",
    content: { label1: "물건조사", emoji: "⏰", label2: "임장", time: "하루<br>4-5시간", arrow: "➡", give_up: "포기!" },
  },
  {
    id: "webinar-final_slide-85",
    sortOrder: 84,
    label: "85. 경매 이제 직접 하지 마세요.",
    content: { line1: "경매 이제", "line1::emphasisText": "직접", line2: "하지 마세요." },
  },
  {
    id: "webinar-final_slide-86",
    sortOrder: 85,
    label: "86. 정답은 스마트 경매",
    content: { line1: "정답은", line2: "스마트 경매" },
  },
  {
    id: "webinar-final_slide-87",
    sortOrder: 86,
    label: "87. 모두 대행으로 가능",
    content: {
      "title::prefix": "모두",
      "title::emphasisText": "대행",
      "title::suffix": "으로 가능",
      label1: "물건찾기",
      label2: "시세조사 & 권리분석",
      label3: "현장임장",
      label4: "입찰 및 대출",
      label5: "명도",
      label6: "인테리어",
      label7: "매도",
    },
  },
  {
    id: "webinar-final_slide-88",
    sortOrder: 87,
    label: "88. 물건 찾는 시간, 이제 필요 없습니다.",
    content: { headerTitle: "물건 찾는 시간, 이제 필요 없습니다." },
  },
  {
    id: "webinar-final_slide-89",
    sortOrder: 88,
    label: "89. 입찰! 법원가지마세요 - 대리입찰 서비스",
    content: {
      "title::highlight": "입찰!",
      "title::suffix": "법원가지마세요",
      subtitle: "대리입찰 서비스",
      cardTitle: "바토너 · batoner.kr",
      cardSubtitle: "바토너 - 법원 경매 대리입찰 서비스",
      cardBody: "바토너는 법원경매 대리입찰 서비스를 제공합니다. 바토너를 통해 대리입찰을 신청하고, 대리입찰 진행 상황을 확인하세요.",
    },
  },
  {
    id: "webinar-final_slide-90",
    sortOrder: 89,
    label: "90. 알림톡 도착 - 낙찰 안내",
    content: {
      badge: "알림톡 도착",
      notice_label: "입찰결과안내",
      result: "낙찰",
      greeting: "코치님,<br>입찰 결과 안내드립니다.",
      case_info: "▶ 사건번호 : 2023타경<br>▶ 결과 : 낙찰",
      congrats: "낙찰을 축하드립니다.🎉<br>이후 사건의 진행 상황은 해당<br>경매계에 직접 문의해 주세요.",
      thanks: "이용해 주셔서 감사합니다.",
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
