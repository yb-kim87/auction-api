import { MigrationInterface, QueryRunner } from "typeorm";

/** "최종본 웨비나"(webinar-final) 덱 21~60번 슬라이드를 시드한다. HTML 원본은
 * 완성되어 있었지만(디자인 시안/PPT-HTML-복원/final/webinar-final-slides.html)
 * DB에는 1~20번만 있었다 — 관리자 페이지에서 21번부터 안 보이는 문제(사용자
 * 요청 — "실제로는 21~60번까지 HTML은 이미 완성되어 있다. 등록하고 DB에
 * 시드해줘", 2026-07-25). content의 필드 키와 값은 프론트엔드
 * SLIDE_FIELD_DEFS(LectureMaterialsTab.tsx)와 반드시 짝이 맞아야 한다.
 * 55~60번은 원본에 사진이 회색 placeholder([이미지 자리: ...])로만 되어
 * 있어 실제 이미지 파일이 없다 — SLIDE_IMAGES에도 등록하지 않았으므로
 * 여기서도 이미지 없이 텍스트만 시드한다(관리자가 나중에 Ctrl+V로 추가). */
export class SeedLectureSlides21to601784240000000 implements MigrationInterface {
  name = "SeedLectureSlides21to601784240000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; sortOrder: number; label: string; content: Record<string, string> }> = [
      { id: "webinar-final_slide-21", sortOrder: 20, label: "21. 저는 누구일까요 (마케팅 사업)", content: { headerTitle: "저는 누구일까요?", line1: "마케팅 사업 성공!", line2: "빚 청산 => 자산 축적" } },
      { id: "webinar-final_slide-22", sortOrder: 21, label: "22. 어디에 투자하지", content: { title: "어디에 투자하지?" } },
      { id: "webinar-final_slide-23", sortOrder: 22, label: "23. 저는 누구일까요 (대치아이파크)", content: { headerTitle: "저는 누구일까요?", label: "첫 투자 계획", title: "대치아이파크", l1: "매매 10억", l2: "전세 7억", "l3::prefix": "투자", "l3::highlight": "3억" } },
      { id: "webinar-final_slide-24", sortOrder: 23, label: "24. 명랑시대 쌀핫도그", content: { headerTitle: "저는 누구일까요?", title: "명랑<br>時代", "l2::tag": "쌀", "l2::suffix": "핫도그" } },
      { id: "webinar-final_slide-25", sortOrder: 24, label: "25. 얼마가 되었을까요", content: { title: "얼마가 되었을까요?" } },
      { id: "webinar-final_slide-26", sortOrder: 25, label: "26. 10억->23억 차트", content: { l1: "10억 -> 23억", l2: "5년 13억", l3: "연 2.6억", l4: "월 2천만원", l5: "현재 32억(22억 수익)" } },
      { id: "webinar-final_slide-27", sortOrder: 26, label: "27. 3억투자 5년13억", content: { l1: "3억투자", l2: "5년13억(400%)", l3: "10년 22억(700%)" } },
      { id: "webinar-final_slide-28", sortOrder: 27, label: "28. 답은 부동산이군", content: { "line::prefix": "답은", "line::suffix": "부동산이군" } },
      { id: "webinar-final_slide-29", sortOrder: 28, label: "29. 2015년 부동산 시작", content: { headerTitle: "경매를 찾아서", year: "2015년", sub: "부동산 시작", l1: "시가: 2.3억", l2: "전세: 1.8억", highlight: "투자금: 5천" } },
      { id: "webinar-final_slide-30", sortOrder: 29, label: "30. 5년 만에 5천으로", content: { headerTitle: "경매를 찾아서", l1: "5년 만에<br>5천 으로", highlight: "4.5억 수익" } },
      { id: "webinar-final_slide-31", sortOrder: 30, label: "31. 답은 부동산이군 (기웃기웃)", content: { l1: "답은 부동산이군", l2: "경매가 좋다고?", caption: "기웃기웃" } },
      { id: "webinar-final_slide-32", sortOrder: 31, label: "32. 연간 수익 1.5억", content: { headerTitle: "경매를 찾아서", sub: "첫 해에 낙찰 4채", title: "연간 수익", highlight: "1.5억" } },
      { id: "webinar-final_slide-33", sortOrder: 32, label: "33. 4년동안 40건 낙찰", content: { headerTitle: "경매를 찾아서", sub: "4년동안", highlight: "40건 낙찰", note: "(지인, 수강생 컨설팅 포함)" } },
      { id: "webinar-final_slide-34", sortOrder: 33, label: "34. 저는 누구일까요 (물건종류)", content: { headerTitle: "저는 누구일까요?", label1: "빌라", label2: "아파트", label3: "다가구(건물)", label4: "공장(토지)" } },
      { id: "webinar-final_slide-35", sortOrder: 34, label: "35. 30대 50억 자산 달성", content: { headerTitle: "경매를 찾아서", sub1: "4년차", sub2: "다가구(건물), 공장(토지), 재개발 빌라", "line::prefix": "30대", "line::highlight": "50억 자산 달성" } },
      { id: "webinar-final_slide-36", sortOrder: 35, label: "36. 처음부터 성공은 아니었습니다", content: { l1: "물론,<br>저도 처음부터", "line::l2a": "성공했던건", l2b: "아니었습니다." } },
      { id: "webinar-final_slide-37", sortOrder: 36, label: "37. 수강료만 2000만원", content: { l1: "수강료만", highlight: "2000만원" } },
      { id: "webinar-final_slide-38", sortOrder: 37, label: "38. 아파트X 6개월동안 패찰", content: { banner: "6개월동안 패찰" } },
      { id: "webinar-final_slide-39", sortOrder: 38, label: "39. 방향전환 (아파트->빌라)", content: { l1: "아파트", l2: "빌라", title: "방향전환" } },
      { id: "webinar-final_slide-40", sortOrder: 39, label: "40. 낙찰을 받기 시작하였습니다", content: { title: "낙찰을 받기 시작하였습니다" } },
      { id: "webinar-final_slide-41", sortOrder: 40, label: "41. 낙찰사례 (시흥동 해비치빌)", content: {
        headerTitle: "낙찰을 받기 시작하였습니다!",
        addr: "서울 금천구 시흥동 823-63, 제5층 제501호 (시흥동, 해비치빌)",
        addr2: "(도로명주소:서울 금천구 독산로22길 35-8)",
        info: "대지권 19.99㎡(6.047평)<br>건물면적 33.4㎡(10.103평)<br>개시결정 2023-06-12(강제경매)",
        party: "소유자 이〇〇<br>채무자 이〇〇<br>채권자 주〇〇〇〇〇〇〇",
        price: "감정가 250,000,000<br>최저가 (80%) 200,000,000<br>매각가 (90%) 225,099,000",
        table: "1차 2023-11-15 250,000,000 유찰<br>매각 225,099,000원 (90.04%) / 입찰 2명 / 용인시 김〇〇<br>(2위금액 200,000,000원)<br>매각결정기일 : 2024-05-16 - 매각허가결정",
        summary: "낙찰 2.2억/매도 2.7억(5천수익)",
      } },
      { id: "webinar-final_slide-42", sortOrder: 41, label: "42. 낙찰사례 (화곡동 동양하우징)", content: {
        headerTitle: "낙찰을 받기 시작하였습니다!",
        addr: "서울 강서구 화곡동 870-1, 제101동 제2층 제203호 (화곡동, 동양하우징) 외 3필지",
        addr2: "(도로명주소:서울 강서구 곰달래로41길 33)",
        info: "대지권 26.45㎡(8.001평)<br>건물면적 43.03㎡(13.017평)<br>개시결정 2023-02-28(강제경매)",
        party: "소유자 육〇〇<br>채무자 육〇〇<br>채권자 주〇〇〇〇〇〇〇",
        price: "감정가 313,000,000<br>최저가 (64%) 200,320,000<br>매각가 (83%) 260,500,000",
        table: "1차 2024-03-07 313,000,000 유찰<br>2차 2024-04-11 250,400,000 유찰<br>3차 2024-05-16 200,320,000<br>매각 260,500,000원 (83.23%) / 입찰 14명 / 용인시 김〇〇<br>(2위금액 255,660,000원)",
        summary: "낙찰 2.6억/매도 2.95억(3.5천수익)",
      } },
      { id: "webinar-final_slide-43", sortOrder: 42, label: "43. 낙찰사례 (낙찰5억 시세8억)", content: {
        headerTitle: "낙찰을 받기 시작하였습니다!",
        table: "1차 2024-12-11 844,057,080 유찰<br>4차 2025-03-26 432,158,000<br>매각 502,799,999원 (59.57%) / 입찰 2명<br>(2위금액 471,000,000원)<br>매각결정기일 : 2025-04-02 - 매각허가결정",
        summary: "낙찰 5억/시세 8억(순월세350)",
      } },
      { id: "webinar-final_slide-44", sortOrder: 43, label: "44. 낙찰사례 (시세15억 낙찰12억)", content: {
        headerTitle: "낙찰을 받기 시작하였습니다!",
        table: "오늘:1  누적:468  평균(2주):0<br>2024-11-25 1,215,738,320 변경<br>1차 2025-05-27 1,215,738,320<br>매각 1,230,099,999원 (101.18%) / 입찰 1명 / 주〇〇〇<br>매각결정기일 : 2025-06-04 - 매각허가결정",
        summary: "시세 15억/ 낙찰 12억(3억싸게)",
      } },
      { id: "webinar-final_slide-45", sortOrder: 44, label: "45. 낙찰사례 (시세17억 매수11억)", content: {
        headerTitle: "낙찰을 받기 시작하였습니다!",
        caseNo: "경매 2024타경55319 서울서부지방법원 6계",
        summary: "시세 17억/매수 11억(6억싸게)",
      } },
      { id: "webinar-final_slide-46", sortOrder: 45, label: "46. 주변 사람에게도 알려주자", content: { headerTitle: "낙찰을 받기 시작하였습니다!", title: "주변 사람에게도 알려주자!" } },
      { id: "webinar-final_slide-47", sortOrder: 46, label: "47. 한 달 만에 낙찰 4천만원 수익", content: { headerTitle: "경매 낙찰 프로젝트", body: "한 달 만에 낙찰<br>2천만원 으로<br>4천만원 수익" } },
      { id: "webinar-final_slide-48", sortOrder: 47, label: "48. 카톡 대화 (수강생 상담1)", content: { caption: "수강생과의 물건 분석/입찰가 상담 카톡 대화" } },
      { id: "webinar-final_slide-49", sortOrder: 48, label: "49. 카톡 대화 (낙찰 소식)", content: { caption: "낙찰 소식을 전하는 카톡 대화 + 낙찰 물건 정보" } },
      { id: "webinar-final_slide-50", sortOrder: 49, label: "50. 수강생 성과_60대 아버님", content: { title: "60대 아버님", l1: "낙찰", l2: "또 낙찰" } },
      { id: "webinar-final_slide-51", sortOrder: 50, label: "51. 수강생 성과_50대/30대 낙찰성공", content: { l1: "50대 아버님<br>7주 만에<br>낙찰 성공!", l2: "30대 직장인<br>10주 만에<br>낙찰 성공!" } },
      { id: "webinar-final_slide-52", sortOrder: 51, label: "52. 방향의 중요성", content: { title: "방향의<br>중요성" } },
      { id: "webinar-final_slide-53", sortOrder: 52, label: "53. 밀착경매", content: { title: "밀착경매" } },
      { id: "webinar-final_slide-54", sortOrder: 53, label: "54. 수업시작 후 단 7주", content: { body: "수업시작 후<br>단 7주!<br>수강생들이 수익을<br>내기 시작했습니다!" } },
      { id: "webinar-final_slide-55", sortOrder: 54, label: "55. 수강생 성과_비규제지역_대출90%", content: {
        headerTitle: "수강생 성과_비규제지역_대출90%",
        label: "비규제빌라",
        info: "시세: 1.9억<br>낙찰: 1.38억(대출90%)<br>투자 : 1.4천<br>수익: 5천",
      } },
      { id: "webinar-final_slide-56", sortOrder: 55, label: "56. 수강생 성과_비규제지역_동시낙찰_대출90%", content: {
        headerTitle: "수강생 성과_비규제지역_동시낙찰_대출90%",
        label: "비규제빌라(동시)",
        info: "대출90%<br>투자A/B : 1.3천/2.1천<br>수익A/B: 4천 / 4천",
      } },
      { id: "webinar-final_slide-57", sortOrder: 56, label: "57. 수강생 성과_다세대주택_규제전", content: {
        headerTitle: "수강생 성과_다세대주택_규제전",
        info: "시세: 2.8억<br>낙찰: 1.7억(대출90%)<br>투자: 2천<br>수익: 1억",
      } },
      { id: "webinar-final_slide-58", sortOrder: 57, label: "58. 수강생 성과_비규제지역_빌라_공시가1억미만", content: {
        headerTitle: "수강생 성과_비규제지역_빌라_공시가1억미만",
        label: "비규제빌라(1주택자)",
        info: "시세: 1.4억<br>낙찰: 1억(대출80%)<br>투자 : 2천<br>수익: 4천",
      } },
      { id: "webinar-final_slide-59", sortOrder: 58, label: "59. 수강생 성과_비규제지역_아파트_90%", content: {
        headerTitle: "수강생 성과_비규제지역_아파트_90%",
        label: "비규제아파트",
        info: "시세: 3.4억<br>낙찰: 2.8억(대출90%)<br>투자 : 3천<br>수익: 6천",
      } },
      { id: "webinar-final_slide-60", sortOrder: 59, label: "60. 수강생 성과_비규제지역_아파트_90%(무주택)", content: {
        headerTitle: "수강생 성과_비규제지역_아파트_90%",
        label: "비규제아파트(무주택)",
        info: "시세: 4억<br>낙찰: 3.3억(대출90%)<br>투자 : 3.3천<br>임차후투자 : 300만원<br>(3000/150)<br>수익: 7천",
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
    const ids = Array.from({ length: 40 }, (_, i) =>
      `webinar-final_slide-${String(i + 21).padStart(2, "0")}`,
    );
    await queryRunner.query(
      `DELETE FROM "lecture_slides" WHERE "id" = ANY($1)`,
      [ids],
    );
  }
}
