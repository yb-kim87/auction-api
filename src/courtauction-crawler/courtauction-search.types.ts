/** 대법원 법원경매정보(courtauction.go.kr) 목록검색 API 파라미터.
 * 2026-09-03 실측(docs/history/2026-07-19_01_courtauction-httpx-exploration.md
 * 追記)으로 cortOfcCd(법원코드)가 반드시 있어야 함을 확인 — "전체 법원"으로
 * 두면 400이 난다. */
export type CourtAuctionSearchConfig = {
  /** 법원 코드(필수, 예: "B000210"=서울중앙지방법원). crawler_probe/cort_ofc_list.json 참고. */
  cortOfcCd: string;
  bidBgngYmd: string; // YYYYMMDD
  bidEndYmd: string; // YYYYMMDD
  /** 용도 대/중/소분류(crawler_probe/lcl_list.json 등). 비워두면 전체 용도. */
  lclDspslGdsLstUsgCd?: string;
  mclDspslGdsLstUsgCd?: string;
  sclDspslGdsLstUsgCd?: string;
  /** 한 번 수집에서 가져올 최대 건수 — 대량 사고 방지용 상한. */
  maxItems: number;
};

export const DEFAULT_COURTAUCTION_SEARCH_CONFIG: CourtAuctionSearchConfig = {
  cortOfcCd: "",
  bidBgngYmd: "",
  bidEndYmd: "",
  lclDspslGdsLstUsgCd: "",
  mclDspslGdsLstUsgCd: "",
  sclDspslGdsLstUsgCd: "",
  maxItems: 40,
};

export type CourtAuctionSavedSearch = {
  id: string;
  name: string;
  search: CourtAuctionSearchConfig;
  createdAt: string;
  updatedAt: string;
};

/** 특이사항 코드표(2026-07-23 실측 확보, sccd_rlet_dspsl_spc_cond_cd.json). */
export const COURT_SPECIAL_COND_LABELS: Record<string, string> = {
  "0004301": "법정지상권",
  "0004302": "별도등기",
  "0004303": "유치권",
  "0004304": "분묘기지권",
  "0004305": "재매각",
  "0004306": "특별매각조건",
  "0004307": "농지취득",
  "0004308": "예고등기",
  "0004309": "선순위",
  "0004310": "우선매수신고",
  "0004311": "맹지",
  "0004399": "특수조건모두제외",
};

/** 용도 대분류(2026-07-23 실측 확보, crawler/courtauction_probe/lcl_list.json).
 * 중/소분류 코드표는 아직 미확보라 화면에서는 자유 입력으로 받는다. */
export const USAGE_LARGE_OPTIONS: Array<{ code: string; name: string }> = [
  { code: "10000", name: "토지" },
  { code: "20000", name: "건물" },
  { code: "30000", name: "차량및운송장비" },
  { code: "40000", name: "기타" },
];

/** 전국 법원 목록(2026-07-23 실측 확보, crawler/courtauction_probe/cort_ofc_list.json
 * — selectCortOfcLst.on API 응답 그대로, 총 60건). 눈대중으로 채우지 않고
 * 저장된 원본 파일 값을 그대로 옮겼다. */
export const COURT_OFFICE_OPTIONS: Array<{ code: string; name: string }> = [
  { code: "B000210", name: "서울중앙지방법원" },
  { code: "B000211", name: "서울동부지방법원" },
  { code: "B000215", name: "서울서부지방법원" },
  { code: "B000212", name: "서울남부지방법원" },
  { code: "B000213", name: "서울북부지방법원" },
  { code: "B000214", name: "의정부지방법원" },
  { code: "B214807", name: "고양지원" },
  { code: "B214804", name: "남양주지원" },
  { code: "B000240", name: "인천지방법원" },
  { code: "B000241", name: "부천지원" },
  { code: "B000250", name: "수원지방법원" },
  { code: "B000251", name: "성남지원" },
  { code: "B000252", name: "여주지원" },
  { code: "B000253", name: "평택지원" },
  { code: "B250826", name: "안산지원" },
  { code: "B000254", name: "안양지원" },
  { code: "B000260", name: "춘천지방법원" },
  { code: "B000261", name: "강릉지원" },
  { code: "B000262", name: "원주지원" },
  { code: "B000263", name: "속초지원" },
  { code: "B000264", name: "영월지원" },
  { code: "B000270", name: "청주지방법원" },
  { code: "B000271", name: "충주지원" },
  { code: "B000272", name: "제천지원" },
  { code: "B000273", name: "영동지원" },
  { code: "B000280", name: "대전지방법원" },
  { code: "B000281", name: "홍성지원" },
  { code: "B000282", name: "논산지원" },
  { code: "B000283", name: "천안지원" },
  { code: "B000284", name: "공주지원" },
  { code: "B000285", name: "서산지원" },
  { code: "B000310", name: "대구지방법원" },
  { code: "B000311", name: "안동지원" },
  { code: "B000312", name: "경주지원" },
  { code: "B000313", name: "김천지원" },
  { code: "B000314", name: "상주지원" },
  { code: "B000315", name: "의성지원" },
  { code: "B000316", name: "영덕지원" },
  { code: "B000317", name: "포항지원" },
  { code: "B000320", name: "대구서부지원" },
  { code: "B000410", name: "부산지방법원" },
  { code: "B000412", name: "부산동부지원" },
  { code: "B000414", name: "부산서부지원" },
  { code: "B000411", name: "울산지방법원" },
  { code: "B000420", name: "창원지방법원" },
  { code: "B000431", name: "마산지원" },
  { code: "B000421", name: "진주지원" },
  { code: "B000422", name: "통영지원" },
  { code: "B000423", name: "밀양지원" },
  { code: "B000424", name: "거창지원" },
  { code: "B000510", name: "광주지방법원" },
  { code: "B000511", name: "목포지원" },
  { code: "B000512", name: "장흥지원" },
  { code: "B000513", name: "순천지원" },
  { code: "B000514", name: "해남지원" },
  { code: "B000520", name: "전주지방법원" },
  { code: "B000521", name: "군산지원" },
  { code: "B000522", name: "정읍지원" },
  { code: "B000523", name: "남원지원" },
  { code: "B000530", name: "제주지방법원" },
];
