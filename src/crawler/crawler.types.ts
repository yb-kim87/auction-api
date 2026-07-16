export type CrawlerSearchConfig = {
  listType: "auction" | "public";
  propertyTypes: string[];
  status: string;
  appraisalMin: string;
  appraisalMax: string;
  preserveRegistryFrom: string;
  excludeSpecialConditions: string[];
  pageSize: string;
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
    repeatAfterCollect: true,
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
};

export type CollectUrlsDto = {
  preset: string;
  clear?: boolean;
  search?: Partial<CrawlerSearchConfig>;
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
