import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 91~100번 슬라이드를 시드한다. HTML 원본은
 * webinar-final-slides.html 파일 끝에 추가되었다(디자인 시안/PPT-HTML-복원/final).
 * content의 필드 키와 값은 프론트엔드 SLIDE_FIELD_DEFS(LectureMaterialsTab.tsx)와
 * 반드시 짝이 맞아야 한다. 92/94/96번은 원본에 카카오톡 대화/편지 스크린샷이
 * 회색 placeholder([이미지 자리: ...])로만 되어 있어 실제 이미지 파일이 없다 —
 * SLIDE_IMAGES에도 등록하지 않았으므로 여기서도 이미지 없이 빈 content로 시드한다
 * (관리자가 나중에 Ctrl+V로 추가). 99번의 6번째 카드도 마찬가지로 이미지 자리만
 * 있고 실제 파일이 없어 content에 포함하지 않았다.
 * "그룹::조각" 키(예: line1::prefix)는 프론트의 groupField()로 정의된 필드로,
 * 같은 줄에서 글자색/굵기가 다른 텍스트 조각을 나눠 편집하기 위한 것이다.
 * 98/100번은 원본 HTML이 top:0/bottom:0 flex 중앙정렬이라, 프론트 기본
 * defaultLayout.top을 그대로 0으로 등록하면 텍스트가 화면 상단에 쌓이는 버그가
 * 있었다(71~90 등록 때 실제 발생) — 여기서는 layout을 시드하지 않고 프론트의
 * 계산된 기본값(top: 400/560)을 그대로 사용하도록 비워둔다. */
export class SeedLectureSlides91to1001784243000000 implements MigrationInterface {
  name = "SeedLectureSlides91to1001784243000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      { id: "webinar-final_slide-91", sortOrder: 90, label: "91. 이제는 임장 부탁하세요 - 당근/해주세요", content: {
        "line1::prefix": "이제는",
        "line1::emphasisText": "임장",
        "line1::suffix": "부탁하세요",
        line2: "당근/해주세요",
        cardTitle: "🙂 해주세요 · www.pleasehelp.co.kr",
        cardSubtitle: "해주세요",
        cardBody: "중개 수수료 0% 포장 수수료 0% 심부름앱 '해주세요'가 음식 배달을 시작합니다!",
      } },
      { id: "webinar-final_slide-92", sortOrder: 91, label: "92. 카카오톡 대화 예시 (해주세요)", content: {} },
      { id: "webinar-final_slide-93", sortOrder: 92, label: "93. 낙찰 후 청소/인테리어 부탁하세요 - 당근/해주세요", content: {
        "line1::prefix": "낙찰 후",
        "line1::emphasisText": "청소/인테리어",
        line2: "당근/해주세요",
        cardTitle: "🥕 당근 · www.daangn.com",
        cardSubtitle: "당신 근처의 당근",
        cardBody: "알바/과외 · 오창읍 · 동네생활 · 중고차 · 모임 · 동네업체",
      } },
      { id: "webinar-final_slide-94", sortOrder: 93, label: "94. 카카오톡 대화 예시 (청소/인테리어)", content: {} },
      { id: "webinar-final_slide-95", sortOrder: 94, label: "95. 낙찰 후 명도 부탁하세요 - 당근/해주세요", content: {
        "line1::prefix": "낙찰 후",
        "line1::emphasisText": "명도",
        line2: "당근/해주세요",
        cardTitle: "🥕 당근 · www.daangn.com",
        cardSubtitle: "당신 근처의 당근",
        cardBody: "알바/과외 · 오창읍 · 동네생활 · 중고차 · 모임 · 동네업체",
      } },
      { id: "webinar-final_slide-96", sortOrder: 95, label: "96. 카카오톡 대화 / 편지 예시 (명도)", content: {} },
      { id: "webinar-final_slide-97", sortOrder: 96, label: "97. 낙찰 후 매도 부탁하세요 - 네이버 부동산", content: {
        "line1::prefix": "낙찰 후",
        "line1::emphasisText": "매도",
        line2: "네이버 부동산",
      } },
      { id: "webinar-final_slide-98", sortOrder: 97, label: "98. 돈많은 사람만 하는거 아니야?", content: {
        "line1::emphasisText": "돈많은",
        "line1::suffix": "사람만",
        line2: "하는거 아니야?",
      } },
      { id: "webinar-final_slide-99", sortOrder: 98, label: "99. 수강생 성과 모음", content: {
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
      } },
      { id: "webinar-final_slide-100", sortOrder: 99, label: "100. 1000만원으로도 수익을 내고 있습니다.", content: {
        "line1::emphasisText": "1000만원으로도",
        line2: "수익을 내고 있습니다.",
      } },
    ];

    for (const row of rows) {
      await queryRunner.query(
        `INSERT INTO "lecture_slides" ("id", "deckId", "sortOrder", "label", "content")
         VALUES ($1, 'webinar-final', $2, $3, $4::jsonb)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.sortOrder, row.label, JSON.stringify(row.content)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const ids = Array.from({ length: 10 }, (_, i) => `webinar-final_slide-${i + 91}`);
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
