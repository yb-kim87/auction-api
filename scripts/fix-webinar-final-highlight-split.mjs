/**
 * 55,56,58,59,60,61,62,63,64,68,69번 슬라이드의 content를 info(작은 글씨)와
 * highlight(원본에서 크게 강조되던 투자/수익 줄)로 분리한다.
 * 관리자 화면에서 이 줄들이 원본보다 작게 보이는 문제(2026-07-25)를 고치기 위함 —
 * SLIDE_FIELD_DEFS를 info/highlight 두 필드로 나눴는데 DB의 기존 content는
 * 여전히 info 하나에 다 들어있어서 반영이 안 됐었다.
 * 사용: node fix-webinar-final-highlight-split.mjs
 */
import fs from "fs";
import initSqlJs from "sql.js";

const dbPath = "E:\\OneDrive\\auctiondev\\young\\auction-api\\data\\auction.db";

const updates = [
  { id: "webinar-final_slide-55", info: "시세: 1.9억<br>낙찰: 1.38억(대출90%)", highlight: "투자 : 1.4천<br>수익: 5천" },
  { id: "webinar-final_slide-56", info: "대출90%", highlight: "투자A/B : 1.3천/2.1천<br>수익A/B: 4천 / 4천" },
  { id: "webinar-final_slide-57", info: "시세: 2.8억<br>낙찰: 1.7억(대출90%)", highlight: "투자: 2천<br>수익: 1억" },
  { id: "webinar-final_slide-58", info: "시세: 1.4억<br>낙찰: 1억(대출80%)", highlight: "투자 : 2천<br>수익: 4천" },
  { id: "webinar-final_slide-59", info: "시세: 3.4억<br>낙찰: 2.8억(대출90%)", highlight: "투자 : 3천<br>수익: 6천" },
  { id: "webinar-final_slide-60", info: "시세: 4억<br>낙찰: 3.3억(대출90%)<br>임차후투자 : 300만원<br>(3000/150)", highlight: "투자 : 3.3천<br>수익: 7천" },
  { id: "webinar-final_slide-61", info: "시세: 2.2억<br>낙찰: 1.8억(대출80%)", highlight: "투자 : 3.6천<br>수익: 4천" },
  { id: "webinar-final_slide-62", info: "시세: 4.2억<br>낙찰: 3.7억(대출90%)", highlight: "투자 : 3.7천<br>수익: 5천" },
  { id: "webinar-final_slide-63", info: "시세: 2.38억<br>낙찰: 1.75억(대출80%)", highlight: "투자 : 4천<br>수익: 5.5천" },
  { id: "webinar-final_slide-64", info: "시세: 2.9억<br>낙찰: 2.4억(대출80%)", highlight: "투자 : 4.8천<br>수익: 5천" },
  { id: "webinar-final_slide-68", info: "시세: 5억<br>낙찰: 4.6억(대출70%)<br>투자 : 1.3억<br>임대후투자 : 8천만원<br>(5000 / 150)", highlight: "수익: 4천" },
  { id: "webinar-final_slide-69", info: "시세: 13억<br>낙찰: 9.6억(대출55%)", highlight: "투자: 4.5억<br>예상수익: 4억" },
];

const SQL = await initSqlJs();
const buf = fs.readFileSync(dbPath);
const db = new SQL.Database(buf);

let updated = 0;
for (const u of updates) {
  const stmt = db.prepare(`SELECT content FROM lecture_slides WHERE id = :id`);
  stmt.bind({ ":id": u.id });
  if (!stmt.step()) {
    console.log(`skip (not found): ${u.id}`);
    stmt.free();
    continue;
  }
  const row = stmt.getAsObject();
  stmt.free();
  const content = JSON.parse(row.content);
  content.info = u.info;
  content.highlight = u.highlight;
  db.run(`UPDATE lecture_slides SET content = :content WHERE id = :id`, {
    ":content": JSON.stringify(content),
    ":id": u.id,
  });
  updated++;
  console.log(`updated: ${u.id}`);
}

fs.writeFileSync(dbPath, Buffer.from(db.export()));
console.log(`완료: ${updated}건 갱신`);
