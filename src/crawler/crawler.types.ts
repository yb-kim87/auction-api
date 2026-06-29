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
};

export type CollectUrlsDto = {
  preset: string;
  clear?: boolean;
  search?: Partial<CrawlerSearchConfig>;
};

export type StartCrawlDto = {
  urls?: string[];
  repeatAfterCollect?: boolean;
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
  remoteWorker?: boolean;
};

export type CrawlerLogEntry = {
  at: string;
  level: "info" | "warn" | "error";
  message: string;
};
