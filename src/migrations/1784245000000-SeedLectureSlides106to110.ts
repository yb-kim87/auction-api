import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 106~110번 슬라이드를 시드한다.
 * 텍스트와 이미지는 원본 PPTX의 slide106~110 XML 및 1920×1080 렌더링 결과에서
 * 추출했으며, 강조 크기가 다른 문구는 관리자 편집기에서 별도 필드로 분리했다. */
export class SeedLectureSlides106to1101784245000000 implements MigrationInterface {
  name = "SeedLectureSlides106to1101784245000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
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
    const ids = Array.from({ length: 5 }, (_, i) => `webinar-final_slide-${i + 106}`);
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
