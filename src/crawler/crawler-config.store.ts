import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_CRAWLER_CONFIG,
  type CrawlerConfig,
} from "./crawler.types";

const CONFIG_DIR = join(process.cwd(), "data", "crawler");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadCrawlerConfig(): CrawlerConfig {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) {
    saveCrawlerConfig(DEFAULT_CRAWLER_CONFIG);
    return structuredClone(DEFAULT_CRAWLER_CONFIG);
  }

  try {
    const parsed = JSON.parse(
      readFileSync(CONFIG_PATH, "utf-8"),
    ) as Partial<CrawlerConfig>;
    return {
      // "검색조건" 화면 진입 시 기본으로 채워지는 값은 항상 코드의 빈 기본값을
      // 쓴다(저장된 파일 값을 무시) — 관리자가 마지막으로 조회했던 조건이
      // 남아있으면 다음 접속자가 그 조건 그대로 조회하는 것으로 오해하기
      // 쉽다(실측: 아파트/2012/위반건축물 제외가 기본 선택된 것처럼 보임,
      // 2026-07-19). 저장해둔 관심조건(savedSearches)은 그대로 보존한다.
      search: structuredClone(DEFAULT_CRAWLER_CONFIG.search),
      algorithm: { ...DEFAULT_CRAWLER_CONFIG.algorithm, ...parsed.algorithm },
      schedule: { ...DEFAULT_CRAWLER_CONFIG.schedule, ...parsed.schedule },
      credentials: {
        ...DEFAULT_CRAWLER_CONFIG.credentials,
        ...parsed.credentials,
      },
      naverCredentials: {
        ...DEFAULT_CRAWLER_CONFIG.naverCredentials,
        ...parsed.naverCredentials,
      },
      savedSearches: parsed.savedSearches ?? DEFAULT_CRAWLER_CONFIG.savedSearches,
    };
  } catch {
    return structuredClone(DEFAULT_CRAWLER_CONFIG);
  }
}

export function saveCrawlerConfig(config: CrawlerConfig) {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
