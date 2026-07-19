import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { Repository } from "typeorm";
import {
  DEFAULT_CRAWLER_CONFIG,
  type CrawlerConfig,
} from "./crawler.types";
import type { CrawlerConfigRow } from "./crawler-config.entity";

const CONFIG_DIR = join(process.cwd(), "data", "crawler");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DB_KEY = "crawler-config";

/** 이 서비스가 뜨는 동안 유지되는 인메모리 캐시. loadCrawlerConfig()/
 * saveCrawlerConfig()는 이 캐시를 동기로 읽고 쓰는 기존 API를 그대로
 * 유지하면서(호출부가 많아 전면 async 전환은 리스크가 큼), 실제 영속화는
 * initCrawlerConfigStore()로 주입된 DB repo를 통해 백그라운드로 반영한다. */
let cache: CrawlerConfig | null = null;
let repo: Repository<CrawlerConfigRow> | null = null;

function ensureDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function mergeWithDefaults(parsed: Partial<CrawlerConfig>): CrawlerConfig {
  return {
    // "검색조건" 화면 진입 시 기본으로 채워지는 값은 항상 코드의 빈 기본값을
    // 쓴다(저장된 값을 무시) — 관리자가 마지막으로 조회했던 조건이 남아있으면
    // 다음 접속자가 그 조건 그대로 조회하는 것으로 오해하기 쉽다(실측:
    // 아파트/2012/위반건축물 제외가 기본 선택된 것처럼 보임, 2026-07-19).
    // 저장해둔 관심조건(savedSearches)은 그대로 보존한다.
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
}

function loadLegacyFileConfig(): Partial<CrawlerConfig> | null {
  ensureDir();
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as Partial<CrawlerConfig>;
  } catch {
    return null;
  }
}

/** 서버 기동 시 1회 호출 — DB에서 설정을 읽어 캐시를 채운다. DB에 아직
 * 값이 없으면, 컨테이너 로컬 파일(과거 저장 방식)에 남아있는 값이 있는지
 * 확인해 1회성으로 옮겨온 뒤(재배포로 파일이 사라지기 전 마지막 구제),
 * 그것도 없으면 기본값으로 시작한다. */
export async function initCrawlerConfigStore(
  configRepo: Repository<CrawlerConfigRow>,
): Promise<CrawlerConfig> {
  repo = configRepo;
  const row = await repo.findOne({ where: { key: DB_KEY } });
  if (row) {
    try {
      cache = mergeWithDefaults(JSON.parse(row.value) as Partial<CrawlerConfig>);
      return structuredClone(cache);
    } catch {
      // 손상된 값이면 기본값으로 폴백해 아래에서 다시 만든다.
    }
  }

  const legacy = loadLegacyFileConfig();
  cache = mergeWithDefaults(legacy ?? {});
  await persist(cache);
  return structuredClone(cache);
}

async function persist(config: CrawlerConfig): Promise<void> {
  if (!repo) return;
  await repo.save({ key: DB_KEY, value: JSON.stringify(config) });
}

/** 동기 캐시 읽기. initCrawlerConfigStore()가 먼저 실행돼 있어야 한다
 * (CrawlerService.onModuleInit에서 서비스 생성 직후 await로 보장). */
export function loadCrawlerConfig(): CrawlerConfig {
  if (!cache) {
    // 초기화 전(예: 유닛 테스트, 초기화 실패) 방어적 폴백.
    cache = mergeWithDefaults(loadLegacyFileConfig() ?? {});
  }
  return structuredClone(cache);
}

/** 동기 캐시 갱신 + DB 반영은 백그라운드로 흘려보낸다(기존 호출부가
 * 전부 동기 함수라 가정하고 있어 시그니처를 유지). DB 쓰기 실패는 다음
 * 저장 시도에서 다시 반영되므로 여기서 굳이 재시도하지 않는다. */
export function saveCrawlerConfig(config: CrawlerConfig) {
  cache = structuredClone(config);
  void persist(cache).catch(() => {
    // 다음 saveCrawlerConfig 호출 때 다시 시도된다.
  });
}
