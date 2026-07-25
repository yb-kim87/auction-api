import { MigrationInterface, QueryRunner } from "typeorm";

/** 강의자료 편집기 파일럿(1번 슬라이드)이 검증되어 나머지 23개 슬라이드를
 * 마저 시드한다 (사용자 요청 — "남은 슬라이드도 가져와보자", 2026-07-24).
 * content의 필드 키와 값은 프론트엔드 SLIDE_FIELD_DEFS(LectureMaterialsTab.tsx)와
 * 반드시 짝이 맞아야 한다 — 필드 키를 바꾸려면 두 곳을 함께 수정할 것. */
export class SeedRemainingLectureSlides1784238000000 implements MigrationInterface {
  name = "SeedRemainingLectureSlides1784238000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      { id: "webinar-2607_slide-02", sortOrder: 1, label: "02. 잘 들리시나요", content: { line1: "잘", line2: "들리시나요??" } },
      { id: "webinar-2607_slide-03", sortOrder: 2, label: "03. 감사인사", content: { title: "참석해 주신 여러분<br>모두 감사합니다." } },
      { id: "webinar-2607_slide-04", sortOrder: 3, label: "04. 이런생각 하고 계시죠", content: { normalText: "이런생각 하고 계시죠?", emphasisText: "다 압니다!" } },
      { id: "webinar-2607_slide-05", sortOrder: 4, label: "05. 시간많은 사람만", content: { prefix: "경매", emphasisText: "시간많은", suffix: "사람만 하는거 아니야?" } },
      { id: "webinar-2607_slide-06", sortOrder: 5, label: "06. 돈많은 사람만", content: { prefix: "그거", emphasisText: "돈많은", suffix: "사람만 하는거 아니야?" } },
      { id: "webinar-2607_slide-07", sortOrder: 6, label: "07. 어렵고 위험", content: { prefix: "경매 그거", emphasisText: "어렵고 위험", suffix: "한거 아니야?" } },
      { id: "webinar-2607_slide-08", sortOrder: 7, label: "08. 오늘 전부 해결", content: { normalText: "오늘 전부", emphasisText: "해결해 드리겠습니다." } },
      { id: "webinar-2607_slide-09", sortOrder: 8, label: "09. 안녕하세요 경매코치입니다", content: { greeting: "안녕하세요 !", normalText: "경매 코치", emphasisText: "입니다" } },
      { id: "webinar-2607_slide-10", sortOrder: 9, label: "10. 저는 누구일까요 (유튜브)", content: { title: "저는 누구일까요?" } },
      { id: "webinar-2607_slide-11", sortOrder: 10, label: "11. 2015년~2023년", content: { line1: "2015년 부동산 투자", tilde: "~", line2: "2023년 경매 시작" } },
      { id: "webinar-2607_slide-12", sortOrder: 11, label: "12. 2015년 부동산 시작", content: { headerTitle: "경매를 찾아서", yearBig: "2015년", yearBig2: "부동산 시작", line1: "시가: 2.3억", line2: "전세: 1.8억", highlight: "투자금: 5천" } },
      { id: "webinar-2607_slide-13", sortOrder: 12, label: "13. 5년 만에 5천으로", content: { headerTitle: "경매를 찾아서", line1: "5년 만에", line2: "5천 으로", highlight: "4.5억 수익" } },
      { id: "webinar-2607_slide-14", sortOrder: 13, label: "14. 답은 부동산이군", content: { normalText: "답은 부동산이군", emphasisText: "경매가 좋다고?" } },
      { id: "webinar-2607_slide-15", sortOrder: 14, label: "15. 연간 수익 1.5억", content: { headerTitle: "경매를 찾아서", subtitle: "첫 해에 낙찰 4채", title: "연간 수익", highlight: "1.5억" } },
      { id: "webinar-2607_slide-16", sortOrder: 15, label: "16. 저는 누구일까요 (물건종류)", content: { headerTitle: "저는 누구일까요?", label1: "빌라", label2: "아파트", label3: "다가구(건물)", label4: "공장(토지)" } },
      { id: "webinar-2607_slide-17", sortOrder: 16, label: "17. 30대 50억 자산 달성", content: { headerTitle: "경매를 찾아서", subtitle: "3년차", detail: "다가구(건물), 공장(토지), 재개발 빌라", prefix: "30대", highlight: "50억 자산", suffix: "달성" } },
      { id: "webinar-2607_slide-18", sortOrder: 17, label: "18. 1~2억 수익 달성", content: { headerTitle: "경매를 찾아서", subtitle: "n년차", detail: "매년 낙찰 후 매도", highlight: "1~2억", suffix: "수익 달성!" } },
      { id: "webinar-2607_slide-19", sortOrder: 18, label: "19. 수강생 성과_재개발 빌라 (7주)", content: { headerTitle: "수강생 성과_재개발 빌라", subtitle: "수업시작", highlight: "7주만에" } },
      { id: "webinar-2607_slide-20", sortOrder: 19, label: "20. 수강생 성과_재개발 빌라 (3억)", content: { headerTitle: "수강생 성과_재개발 빌라", line1: "시세: 13억", line2: "낙찰: 9.6억", highlight: "3억", suffix: "차익" } },
      { id: "webinar-2607_slide-21", sortOrder: 20, label: "21. 수강생 성과_50대 어머님 (1.1억)", content: { headerTitle: "수강생 성과_50대 어머님", line1: "낙찰: 1.77억", line2: "매도: 2.87억", line3: "매도 기간 : 6개월", highlight: "1.1억", suffix: "차익" } },
      { id: "webinar-2607_slide-22", sortOrder: 21, label: "22. 수강생 성과_50대 어머님 (전업투자자)", content: { headerTitle: "수강생 성과_50대 어머님", normalText: "이후에도 계속 낙찰", highlight1: "매년 2건", highlight2: "전업 투자자 전향" } },
      { id: "webinar-2607_slide-23", sortOrder: 22, label: "23. 수강생 성과 그 외 수강생", content: { headerTitle: "수강생 성과 그 외 수강생", line1: "아파트 단타<br>아파트 내집마련", line2: "빌라 단타", line3: "재개발 빌라 단타" } },
      { id: "webinar-2607_slide-24", sortOrder: 23, label: "24. 1번 입찰 있다 / 2번 없다", content: { line1Prefix: "1번", line1Middle: "입찰 해본적", line1Suffix: "있다", line2Prefix: "2번", line2Middle: "입찰 해본적", line2Suffix: "없다" } },
    ];

    for (const row of rows) {
      await queryRunner.query(
        `INSERT INTO "lecture_slides" ("id", "deckId", "sortOrder", "label", "content")
         VALUES ($1, 'webinar-2607', $2, $3, $4::jsonb)
         ON CONFLICT ("id") DO NOTHING`,
        [row.id, row.sortOrder, row.label, JSON.stringify(row.content)],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const ids = Array.from({ length: 23 }, (_, i) =>
      `webinar-2607_slide-${String(i + 2).padStart(2, "0")}`,
    );
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
