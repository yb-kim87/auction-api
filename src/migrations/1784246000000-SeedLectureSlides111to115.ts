import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 111~115번 슬라이드를 시드한다.
 * 텍스트와 이미지는 원본 PPTX의 slide111~115 XML 및 1920×1080 렌더링 결과에서
 * 추출했으며, 강조 색상이 다른 문구는 관리자 편집기에서 별도 필드로 분리한다. */
export class SeedLectureSlides111to1151784246000000 implements MigrationInterface {
  name = "SeedLectureSlides111to1151784246000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      {
        id: "webinar-final_slide-111",
        sortOrder: 110,
        label: "111. 복잡한 권리분석! 직접 하지 않아도 됩니다.",
        content: { headerTitle: "복잡한 권리분석! 직접 하지 않아도 됩니다." },
      },
      {
        id: "webinar-final_slide-112",
        sortOrder: 111,
        label: "112. 90%물건 - 시세파악/안전마진/입찰가",
        content: { title: "90%물건", market: "시세파악", margin: "안전마진", bid: "입찰가" },
      },
      {
        id: "webinar-final_slide-113",
        sortOrder: 112,
        label: "113. 명도 너무 걱정돼요",
        content: { "line::emphasisText": "명도", "line::suffix": " 너무 걱정돼요" },
      },
      {
        id: "webinar-final_slide-114",
        sortOrder: 113,
        label: "114. 여러분이 생각하는 명도",
        content: {
          title: "명도?",
          "footer::prefix": "여러분이 생각하는 ",
          "footer::emphasisText": "명도",
        },
      },
      {
        id: "webinar-final_slide-115",
        sortOrder: 114,
        label: "115. 미해결 명도 0건",
        content: {
          title: "미해결 명도 0건",
          line1: "명도의 핵심은 얼마나 절약하는지",
          line2: "처음부터 끝까지 절약해 드려요",
          "line3::prefix": "(",
          "line3::emphasisText": "최소 200만원이상 절약효과",
          "line3::suffix": ")",
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
    const ids = Array.from({ length: 5 }, (_, i) => `webinar-final_slide-${i + 111}`);
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
