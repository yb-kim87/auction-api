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
      search: { ...DEFAULT_CRAWLER_CONFIG.search, ...parsed.search },
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
