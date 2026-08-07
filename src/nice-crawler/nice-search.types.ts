/** 나이스옥션 상세검색(/search/total) 파라미터 — 셀레니움으로 실제 폼을
 * 조작해 캡처한 요청 URL로 확인한 이름 그대로 쓴다(2026-08-07,
 * docs/niceauction-integration-research.md 참고). 탱크옥션 CrawlerSearchConfig와
 * 거의 1:1 대응되지만, 지역코드 체계가 다르다(탱크: 자체 siCd/guCd,
 * 나이스: 법정동코드 pnuCd) — 이건 자동 변환하지 않고 나이스 화면에서
 * 직접 고르게 한다. */
export type NiceSearchConfig = {
  objTypes: "경매" | "공매";
  /** 용도 코드 다중 선택(nice_yongdo_code_map.json의 키, 예: "2020104"). */
  yongdoCd: string[];
  /** 진행상태 코드 다중 선택(nice_progstatus_code_map.json의 키). 빈 배열이면
   * 나이스 기본값(진행물건 계열)을 그대로 둔다. */
  objProgStatusCd: string[];
  caseYear?: string;
  caseSerial?: string;
  courtCd?: string;
  /** 소재지(법정동코드, 시/도~동/면/읍 드롭다운으로 조합해 얻는다). */
  pnuCd?: string;
  dspslDxdyYmdStart?: string;
  dspslDxdyYmdEnd?: string;
  uchalCntStart?: string;
  uchalCntEnd?: string;
  gamjungAmtStart?: string;
  gamjungAmtEnd?: string;
  minAmtStart?: string;
  minAmtEnd?: string;
  gamjungAmtRateStart?: string;
  gamjungAmtRateEnd?: string;
  tojiAreaStart?: string;
  tojiAreaEnd?: string;
  bldgAreaStart?: string;
  bldgAreaEnd?: string;
  initRegYmdStart?: string;
  initRegYmdEnd?: string;
  gamjungCompanyNm?: string;
  soyujaNm?: string;
  chamujaNm?: string;
  chaeonjaNm?: string;
  /** 특수조건 코드 다중 선택(nice_specialobjcd_code_map.json의 키, 예: "13000031"=유치권).
   * 쿼리 파라미터 specialObjCd(콤마 구분)로 전달 — 카운트 델타로 실제 필터링
   * 동작을 검증했다(2026-08-07). */
  specialObjCd?: string[];
  /** specialObjCd 적용 방식. "exclude"=선택 항목 제외, "include"=선택 항목만
   * 포함(1개 이상 매칭). 탱크옥션엔 "선택 모두 포함"(AND) 모드도 있지만
   * 나이스에서 AND 매칭 파라미터는 별도로 확인되지 않아 지원하지 않는다. */
  specialObjCdMode?: "include" | "exclude";
  /** 한 번 실행에서 처리할 최대 건수 — 대량 실행 사고(2026-08-06 주택
   * 공시가격 임포트로 운영 DB 다운) 재발 방지를 위해 항상 상한을 둔다. */
  maxItems: number;
};

export const DEFAULT_NICE_SEARCH_CONFIG: NiceSearchConfig = {
  objTypes: "경매",
  yongdoCd: [],
  objProgStatusCd: [],
  maxItems: 50,
};

export type NiceSavedSearch = {
  id: string;
  name: string;
  search: NiceSearchConfig;
  createdAt: string;
  updatedAt: string;
};
