export type CrawlerSearchConfig = {
  listType: "auction" | "public";
  propertyTypes: string[];
  status: string;
  appraisalMin: string;
  appraisalMax: string;
  preserveRegistryFrom: string;
  /** 보존등기 상한 연도(탱크옥션 prsvEnd, 예: "2005" = ~2005년, "구축" 조건의 핵심). */
  preserveRegistryTo?: string;
  /** 해당층(물건이 위치한 층, 총 층수와 다름) 하한(탱크옥션 flrBgn, 101=1층). */
  objectFloorMin?: string;
  /** 해당층 상한(탱크옥션 flrEnd, 103=3층). "저층 단타" 같은 조건의 핵심. */
  objectFloorMax?: string;
  excludeSpecialConditions: string[];
  pageSize: string;
  /** 사건번호 연도(탱크옥션 sn1, 예: "2024"). 빈 값이면 전체 연도. */
  caseYear?: string;
  /** 사건번호 일련번호(탱크옥션 sn2, 정확히 일치). 빈 값이면 무시. */
  caseSerial?: string;
  /** 물건번호(탱크옥션 pn). 빈 값이면 무시. */
  itemNumber?: string;
  /** 시/도 코드(탱크옥션 siCd, 예: 서울=11). 빈 값이면 전국. */
  regionSiCd?: string;
  /** 시/군/구 코드(탱크옥션 guCd). regionSiCd 선택 후에만 의미 있음. */
  regionGuCd?: string;
  /** 읍/면/동 코드(탱크옥션 dnCd). regionGuCd 선택 후에만 의미 있음. */
  regionDnCd?: string;
  /** 여러 지역을 동시 선택했을 때의 법정동 코드 목록(탱크옥션 adrPlural,
   * 콤마 구분 문자열, 예: "4128000000,4131000000"). 탱크옥션 즐겨찾기
   * 항목을 불러올 때만 채워지며, 관리자 화면에는 지역 코드 UI가 없어
   * 직접 편집할 수 없다 — 값이 있으면 검색 시 regionGuCd 단일값보다
   * 우선한다(실측: guCd 단일값만 쓰면 검색이 지나치게 좁아져 0건이
   * 나옴, 2026-07-17). */
  regionAdrPlural?: string;
  /** 세부주소/건물명 검색어(자유 텍스트, 탱크옥션 adrsEtc). */
  addressKeyword?: string;
  /** 최저가 하한(원 단위 문자열, 탱크옥션 minbAmtBgn). */
  minPriceMin?: string;
  /** 최저가 상한(원 단위 문자열, 탱크옥션 minbAmtEnd). */
  minPriceMax?: string;
  /** 최저가율 하한(0~1 소수 문자열, 탱크옥션 minbPctBgn, 예: "0.5" = 50%). */
  minPricePctMin?: string;
  /** 최저가율 상한(0~1 소수 문자열, 탱크옥션 minbPctEnd). */
  minPricePctMax?: string;
  /** 대지면적 하한(㎡, 탱크옥션 landSqmBgn). */
  landAreaMin?: string;
  /** 대지면적 상한(㎡, 탱크옥션 landSqmEnd). */
  landAreaMax?: string;
  /** 건물면적 하한(㎡, 탱크옥션 bldgSqmBgn). */
  buildingAreaMin?: string;
  /** 건물면적 상한(㎡, 탱크옥션 bldgSqmEnd). */
  buildingAreaMax?: string;
  /** 총 층수 하한(탱크옥션 totFlrBgn). */
  totalFloorMin?: string;
  /** 총 층수 상한(탱크옥션 totFlrEnd). */
  totalFloorMax?: string;
  /** 유찰 횟수 하한(탱크옥션 fbCntBgn). */
  failCountMin?: string;
  /** 유찰 횟수 상한(탱크옥션 fbCntEnd). */
  failCountMax?: string;
  /** 매각기일 시작일(YYYY-MM-DD, 탱크옥션 bgnDt). */
  bidDateFrom?: string;
  /** 매각기일 종료일(YYYY-MM-DD, 탱크옥션 endDt). */
  bidDateTo?: string;
  /** 경매구분(탱크옥션 auctType: 0=전체, 1=임의경매, 2=강제경매 — 검색 폼 select 실측). */
  auctionType?: string;
  /** 매각/공고 구분(탱크옥션 dpslDvsn 코드 — 검색 폼 select 실측, 0=전체). */
  saleDivision?: string;
};

/** 관리자가 이름 붙여 저장한 검색조건("즐겨찾기") — 아파트/빌라 같은 고정
 * 프리셋 버튼처럼 목록에서 눌러 즉시 적용/조회할 수 있다. */
export type SavedSearchPreset = {
  id: string;
  name: string;
  search: CrawlerSearchConfig;
  createdAt: string;
  updatedAt: string;
};

export type CrawlerAlgorithmConfig = {
  enabled: boolean;
  minArea: number;
  minGapPriceMan: number;
  minHouseholds: number;
  registryKeyword: string;
  telegramEnabled: boolean;
};

export type CrawlerScheduleConfig = {
  enabled: boolean;
  time: string;
  preset: string;
  repeatAfterCollect: boolean;
  excludeDuplicates: boolean;
  repeatDaily: boolean;
  oneTimeCompleted?: boolean;
  /** 자동 스케줄 실행 시 사용할 크롤러 경로. 미지정 시 v1(기존 Selenium, 회귀 없음). */
  crawlerVersion?: CrawlerVersion;
};

export type CrawlerCredentialsConfig = {
  userId: string;
  password: string;
};

export type CrawlerConfig = {
  search: CrawlerSearchConfig;
  algorithm: CrawlerAlgorithmConfig;
  schedule: CrawlerScheduleConfig;
  credentials: CrawlerCredentialsConfig;
  naverCredentials: CrawlerCredentialsConfig;
  savedSearches: SavedSearchPreset[];
};

export const DEFAULT_CRAWLER_CONFIG: CrawlerConfig = {
  search: {
    listType: "auction",
    propertyTypes: ["아파트"],
    status: "진행물건",
    appraisalMin: "8억",
    appraisalMax: "30억",
    preserveRegistryFrom: "2012",
    excludeSpecialConditions: ["위반건축물"],
    pageSize: "100",
  },
  algorithm: {
    enabled: true,
    minArea: 85,
    minGapPriceMan: 50000,
    minHouseholds: 10000,
    registryKeyword: "",
    telegramEnabled: true,
  },
  schedule: {
    enabled: false,
    time: "00:00",
    preset: "현재",
    repeatAfterCollect: false,
    excludeDuplicates: true,
    repeatDaily: true,
    oneTimeCompleted: false,
  },
  credentials: {
    userId: "zgamez",
    password: "young1!",
  },
  naverCredentials: {
    userId: "",
    password: "",
  },
  savedSearches: [],
};

export type CollectUrlsDto = {
  preset: string;
  clear?: boolean;
  search?: Partial<CrawlerSearchConfig>;
  crawlerVersion?: CrawlerVersion;
};

/**
 * v1: 기존 Selenium 전체 경로 (/crawl/start)
 * v2: HTTPX(목록/상세) + Selenium(네이버부동산) 하이브리드 (/crawl/start-v2)
 * v3: 완전 HTTPX(브라우저 없음, curl_cffi 기반 네이버 조회 포함) (/crawl/start-v3)
 * 미지정 시 v1(기존 동작, 회귀 없음).
 */
export type CrawlerVersion = "v1" | "v2" | "v3";

export type StartCrawlDto = {
  urls?: string[];
  repeatAfterCollect?: boolean;
  crawlerVersion?: CrawlerVersion;
};

export type CrawlerLoginDto = {
  userId?: string;
  password?: string;
};

/** 탱크옥션 "즐겨쓰는 검색" 항목(server_v3.py: _fetch_favorite_searches_v3). */
export type TankFavoriteSearch = {
  id: string;
  title: string;
  count?: number;
  search: Partial<CrawlerSearchConfig>;
};

export type SaveSearchPresetDto = {
  id?: string;
  name: string;
  search: CrawlerSearchConfig;
};

export type ManageUrlsDto = {
  action: "add" | "remove" | "clear" | "load";
  url?: string;
  indices?: number[];
  urls?: CrawlerUrlEntry[];
};

export type CrawlerUrlEntry = {
  label: string;
  url: string;
};

export type CrawlerPhase =
  | "idle"
  | "starting"
  | "logging_in"
  | "collecting"
  | "crawling"
  | "stopped"
  | "error";

export type CrawlerStatus = {
  workerRunning: boolean;
  browserReady: boolean;
  phase: CrawlerPhase;
  preset: string;
  urls: CrawlerUrlEntry[];
  completed: number;
  total: number;
  created: number;
  updated: number;
  repeatAfterCollect: boolean;
  scheduledTime: string | null;
  scheduleEnabled: boolean;
  scheduleRepeatDaily: boolean;
  excludeDuplicates: boolean;
  error: string | null;
  lastMessage: string | null;
  tankLoggedIn?: boolean | null;
  remoteWorker?: boolean;
};

export type CrawlerLogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
};
