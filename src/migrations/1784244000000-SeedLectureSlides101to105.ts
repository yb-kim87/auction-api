import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 101~105번 슬라이드를 시드한다.
 * 101번은 원본 pptx 자체에 100번과 완전히 동일한 슬라이드가 중복 삽입되어 있어
 * 그대로 재현했다. 102번은 원본 슬라이드에 발표자 메모("## 지방아파트/...")가
 * 텍스트 그대로 남아있던 것을 그대로 옮겼다(재해석하지 않음, PPT-HTML-복원-규칙 9번). */
export class SeedLectureSlides101to1051784244000000 implements MigrationInterface {
  name = "SeedLectureSlides101to1051784244000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      { id: "webinar-final_slide-101", sortOrder: 100, label: "101. 1000만원으로도 수익 (원본 100번과 동일 슬라이드 중복)", content: {
        "line1::emphasisText": "1000만원으로도",
        line2: "수익을 내고 있습니다.",
      } },
      { id: "webinar-final_slide-102", sortOrder: 101, label: "102. 지방아파트/오피스텔 소액사례 (메모 텍스트)", content: {
        body: "## 지방아파트/ 오피스텔 현재 소액 사례 보여주기",
      } },
      { id: "webinar-final_slide-103", sortOrder: 102, label: "103. 소득이 없는데 대출이 될까요?", content: {
        emoji: "🤔",
        line1: "소득이 없는데",
        line2: "대출이 될까요?",
      } },
      { id: "webinar-final_slide-104", sortOrder: 103, label: "104. 경락잔금대출 - 감정가90%/낙찰가80%", content: {
        title: "경락잔금대출",
        body: "감정가의 90%<br>낙찰가의 80%",
      } },
      { id: "webinar-final_slide-105", sortOrder: 104, label: "105. 경락잔금대출 - 1억낙찰/투자금1000만원", content: {
        title: "경락잔금대출",
        body: "1억 낙찰(90%대출)<br><br>투자금 1000만원(10%)",
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
    const ids = Array.from({ length: 5 }, (_, i) => `webinar-final_slide-${i + 101}`);
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
