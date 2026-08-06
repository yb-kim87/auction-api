/**
 * 최종본 웨비나 슬라이드 61~70 시드 (sql.js 로컬 DB 전용).
 * 사용: node seed-webinar-final-61-70.mjs
 * 이미 존재하는 id는 건너뜁니다(안전 재실행 가능).
 */
import fs from "fs";
import path from "path";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const rows = [
  { id: "webinar-final_slide-61", sortOrder: 60, label: "61. 수강생 성과_비규제지역_빌라_대출80%", content: { headerTitle: "수강생 성과_비규제지역_빌라_대출80%", label: "비규제빌라(1주택자)", info: "시세: 2.2억<br>낙찰: 1.8억(대출80%)<br>투자 : 3.6천<br>수익: 4천" } },
  { id: "webinar-final_slide-62", sortOrder: 61, label: "62. 수강생 성과_비규제지역_아파트_90%", content: { headerTitle: "수강생 성과_비규제지역_아파트_90%", label: "비규제아파트", info: "시세: 4.2억<br>낙찰: 3.7억(대출90%)<br>투자 : 3.7천<br>수익: 5천" } },
  { id: "webinar-final_slide-63", sortOrder: 62, label: "63. 수강생 성과_아파트 중장기_규제전", content: { headerTitle: "수강생 성과_아파트 중장기_규제전", label: "비규제빌라", info: "시세: 2.38억<br>낙찰: 1.75억(대출80%)<br>투자 : 4천<br>수익: 5.5천" } },
  { id: "webinar-final_slide-64", sortOrder: 63, label: "64. 수강생 성과_규제지역_대출80%", content: { headerTitle: "수강생 성과_규제지역_대출80%", label: "규제빌라", info: "시세: 2.9억<br>낙찰: 2.4억(대출80%)<br>투자 : 4.8천<br>수익: 5천" } },
  { id: "webinar-final_slide-65", sortOrder: 64, label: "65. 수강생 성과_아파트 중장기_규제전", content: { headerTitle: "수강생 성과_아파트 중장기_규제전", info: "시세: 9.2억<br>낙찰: 7억(대출80%)<br>보증금 : 8천 / 월 200<br>이자 : 200(4%)", highlight: "투자: 6천<br>월이자 0원<br>예상수익: 2.2억" } },
  { id: "webinar-final_slide-66", sortOrder: 65, label: "66. 수강생 성과_아파트 중장기_규제전", content: { headerTitle: "수강생 성과_아파트 중장기_규제전", info: "시세: 9.2억<br>낙찰: 7억(대출80%)<br>보증금 : 8천 / 월 200<br>이자 : 200(4%)", highlight: "투자: 6천<br>월이자 0원<br>예상수익: 2.2억" } },
  { id: "webinar-final_slide-67", sortOrder: 66, label: "67. 수강생 성과_비규제지역_아파트_80%", content: { headerTitle: "수강생 성과_비규제지역_아파트_80%", info: "시세: 8.4억<br>낙찰: 7.3억(대출80%)<br>월세 : 7000 / 180", highlight: "투자 : 7천<br>수익: 1.1억" } },
  { id: "webinar-final_slide-68", sortOrder: 67, label: "68. 수강생 성과_비규제지역_아파트_비규제", content: { headerTitle: "수강생 성과_비규제지역_아파트_비규제", label: "비규제아파트(무주택)", info: "시세: 5억<br>낙찰: 4.6억(대출70%)<br>투자 : 1.3억<br>임대후투자 : 8천만원<br>(5000 / 150)<br>수익: 4천" } },
  { id: "webinar-final_slide-69", sortOrder: 68, label: "69. 수강생 성과_규제지역_대출55%", content: { headerTitle: "수강생 성과_규제지역_대출55%", label: "재개발빌라", info: "시세: 13억<br>낙찰: 9.6억(대출55%)<br>투자: 4.5억<br>예상수익: 4억" } },
  { id: "webinar-final_slide-70", sortOrder: 69, label: "70. 수강생 성과_규제지역_대출55%(지도)", content: { headerTitle: "수강생 성과_규제지역_대출55%" } },
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
