import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 61~70번 슬라이드를 시드한다. HTML 원본은
 * webinar-final-slides.html 파일 끝에 추가되었다(디자인 시안/PPT-HTML-복원/final).
 * content의 필드 키와 값은 프론트엔드 SLIDE_FIELD_DEFS(LectureMaterialsTab.tsx)와
 * 반드시 짝이 맞아야 한다. 61~70번은 모두 원본에 사진이 회색 placeholder([이미지
 * 자리: ...])로만 되어 있어 실제 이미지 파일이 없다 — SLIDE_IMAGES에도 등록하지
 * 않았으므로 여기서도 이미지 없이 텍스트만 시드한다(관리자가 나중에 Ctrl+V로 추가).
 * 70번은 지도+정보 두 placeholder만 있고 본문 텍스트가 없어 headerTitle만 시드한다. */
export class SeedLectureSlides61to701784241000000 implements MigrationInterface {
  name = "SeedLectureSlides61to701784241000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      { id: "webinar-final_slide-61", sortOrder: 60, label: "61. 수강생 성과_비규제지역_빌라_대출80%", content: {
        headerTitle: "수강생 성과_비규제지역_빌라_대출80%",
        label: "비규제빌라(1주택자)",
        info: "시세: 2.2억<br>낙찰: 1.8억(대출80%)<br>투자 : 3.6천<br>수익: 4천",
      } },
      { id: "webinar-final_slide-62", sortOrder: 61, label: "62. 수강생 성과_비규제지역_아파트_90%", content: {
        headerTitle: "수강생 성과_비규제지역_아파트_90%",
        label: "비규제아파트",
        info: "시세: 4.2억<br>낙찰: 3.7억(대출90%)<br>투자 : 3.7천<br>수익: 5천",
      } },
      { id: "webinar-final_slide-63", sortOrder: 62, label: "63. 수강생 성과_아파트 중장기_규제전", content: {
        headerTitle: "수강생 성과_아파트 중장기_규제전",
        label: "비규제빌라",
        info: "시세: 2.38억<br>낙찰: 1.75억(대출80%)<br>투자 : 4천<br>수익: 5.5천",
      } },
      { id: "webinar-final_slide-64", sortOrder: 63, label: "64. 수강생 성과_규제지역_대출80%", content: {
        headerTitle: "수강생 성과_규제지역_대출80%",
        label: "규제빌라",
        info: "시세: 2.9억<br>낙찰: 2.4억(대출80%)<br>투자 : 4.8천<br>수익: 5천",
      } },
      { id: "webinar-final_slide-65", sortOrder: 64, label: "65. 수강생 성과_아파트 중장기_규제전", content: {
        headerTitle: "수강생 성과_아파트 중장기_규제전",
        info: "시세: 9.2억<br>낙찰: 7억(대출80%)<br>보증금 : 8천 / 월 200<br>이자 : 200(4%)",
        highlight: "투자: 6천<br>월이자 0원<br>예상수익: 2.2억",
      } },
      { id: "webinar-final_slide-66", sortOrder: 65, label: "66. 수강생 성과_아파트 중장기_규제전", content: {
        headerTitle: "수강생 성과_아파트 중장기_규제전",
        info: "시세: 9.2억<br>낙찰: 7억(대출80%)<br>보증금 : 8천 / 월 200<br>이자 : 200(4%)",
        highlight: "투자: 6천<br>월이자 0원<br>예상수익: 2.2억",
      } },
      { id: "webinar-final_slide-67", sortOrder: 66, label: "67. 수강생 성과_비규제지역_아파트_80%", content: {
        headerTitle: "수강생 성과_비규제지역_아파트_80%",
        info: "시세: 8.4억<br>낙찰: 7.3억(대출80%)<br>월세 : 7000 / 180",
        highlight: "투자 : 7천<br>수익: 1.1억",
      } },
      { id: "webinar-final_slide-68", sortOrder: 67, label: "68. 수강생 성과_비규제지역_아파트_비규제", content: {
        headerTitle: "수강생 성과_비규제지역_아파트_비규제",
        label: "비규제아파트(무주택)",
        info: "시세: 5억<br>낙찰: 4.6억(대출70%)<br>투자 : 1.3억<br>임대후투자 : 8천만원<br>(5000 / 150)<br>수익: 4천",
      } },
      { id: "webinar-final_slide-69", sortOrder: 68, label: "69. 수강생 성과_규제지역_대출55%", content: {
        headerTitle: "수강생 성과_규제지역_대출55%",
        label: "재개발빌라",
        info: "시세: 13억<br>낙찰: 9.6억(대출55%)<br>투자: 4.5억<br>예상수익: 4억",
      } },
      { id: "webinar-final_slide-70", sortOrder: 69, label: "70. 수강생 성과_규제지역_대출55%(지도)", content: {
        headerTitle: "수강생 성과_규제지역_대출55%",
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
    const ids = Array.from({ length: 10 }, (_, i) =>
      `webinar-final_slide-${String(i + 61).padStart(2, "0")}`,
    );
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
