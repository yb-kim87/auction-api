import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as zlib from "zlib";
import { MoreThan, Repository } from "typeorm";
import { RedevelopmentPoint, RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";
import { RedevelopmentZoneAutoSync } from "./entities/redevelopment-zone-auto-sync.entity";
import { RedevelopmentZoneChange } from "./entities/redevelopment-zone-change.entity";
import { RedevelopmentZoneSyncRun, ZoneChangeType } from "./entities/redevelopment-zone-sync-run.entity";

const DATASET_ID = "jaegebal";
const API_BASE = "https://jaegebal.com/api";
// 사이트 JS에 공개된 값. 사이트 배포로 바뀌면 환경변수로 재배포 없이 교체한다.
const SIGNING_KEY = process.env.JDC_SIGNING_KEY || "57bfe0da55e35b096fd0a4ac27ca2c35b40f13e2827442e4771c999b2cec1c74";
const APP_TOKEN = process.env.JDC_APP_TOKEN || "0418b9cadfb234a22035c05e982492cf02b62fa91bc89e217f8f93c7e6f0e10f";
const DEVICE_ID = process.env.JDC_DEVICE_ID || "web;e92feeb0-f0bd-4ca7-961c-85537a203a35";
/** 사람 행동을 흉내 내지 않는다: 활동 0, 마지막 칸 1 = 자동화 클라이언트 표시. */
const BEHAVIOR = "1.0.0.0.0.0.0.0.0.0.0.1";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

/** 최소 수집 원칙(사용자 결정, 2026-10-30): 간격을 크게 두고 천천히. 구가 MAX_DISTRICTS_PER_RUN개를 넘으면 자동으로 느린 간격을 쓴다. */
export const MAX_DISTRICTS_PER_RUN = 3;
const REQUEST_GAP_MS = 30_000;
const MIN_RESYNC_HOURS = 6;
/** 같은 구역 권리산정기준일 확인 사이 최소 간격. */
const RIGHT_DATE_MIN_GAP_MS = 30_000;
/** 느린 순차 모드(구 4개 이상, 사용자 결정 2026-10-30) — 구 하나 안에서 요청 사이 60초, 구와 구 사이 120초.
 * 구당 약 3분, 25개 구 약 75분(분당 0.7건). 첫 보안 확인에서 전체 중단, 구 오류가 연속 2번이면 중단. */
const ALL_REQUEST_GAP_MS = 60_000;
const ALL_DISTRICT_GAP_MS = 120_000;
const ALL_MAX_CONSECUTIVE_ERRORS = 2;
const BOX_MARGIN = 0.002;
/** 응답이 DB에 있던 구역 수에 비해 너무 적으면(부분 응답 의심) "사라진 구역" 표시를 하지 않는다. */
const MISSING_SANITY_RATIO = 0.5;
const MISSING_SANITY_MIN_ZONES = 10;
const MAX_CHANGE_LOG = 200;

/** 자동 업데이트(사용자 요청 2026-10-30): 켜면 지정한 구를 주기마다 서버가 실행한다. 기본 꺼짐·14일. */
const AUTO_ID = "jaegebal";
export const AUTO_DEFAULT_INTERVAL_DAYS = 14;
const AUTO_TICK_MS = 60_000;
/** 기본 실행 시각(한국시간) 03:00 — 사용자가 화면에서 시·분을 바꿀 수 있다. */
export const AUTO_DEFAULT_RUN_HOUR = 3;
export const AUTO_DEFAULT_RUN_MINUTE = 0;
/** 보안 확인·오류로 실패하면 하루 뒤에 한 번 다시 시도한다(바로 재시도하지 않음). */
const AUTO_RETRY_AFTER_FAILURE_MS = 24 * 3600_000;
const DAY_MS = 24 * 3600_000;

/** 기준 시각의 한국시간 날짜 + intervalDays일, 그날 한국시간 hour:minute — 자동 업데이트의 다음 실행 시각. */
export function nextRunTime(base: Date, intervalDays: number, hour: number, minute: number): Date {
  const kst = new Date(base.getTime() + 9 * 3600_000);
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + intervalDays, hour, minute) - 9 * 3600_000);
}

/** 서울 25개 구 코드 → 구 이름(재개발닷컴 지역 코드). 설명 문구에 구 이름이 없는 구역(예: "홍제1")도 지역을 채우기 위해 쓴다. */
const SEOUL_DISTRICT_NAMES: Record<string, string> = {
  "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구", "11215": "광진구", "11230": "동대문구",
  "11260": "중랑구", "11290": "성북구", "11305": "강북구", "11320": "도봉구", "11350": "노원구", "11380": "은평구",
  "11410": "서대문구", "11440": "마포구", "11470": "양천구", "11500": "강서구", "11530": "구로구", "11545": "금천구",
  "11560": "영등포구", "11590": "동작구", "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구", "11740": "강동구",
};

type RawArea = number[][][][]; // [polygon][ring][[lng, lat]]
type RawDevelop = {
  id: number;
  title?: string;
  description?: string;
  region_code?: string;
  type_display_name?: string;
  detail_stage?: string;
  areas?: RawArea;
  num_sedaes?: number | null;
  num_owners?: number | null;
  building_oldness_pct?: number | null;
  building_oldness_pct_5y?: number | null;
  building_oldness_pct_10y?: number | null;
  land_zoning_ratios?: Array<[string, number]> | null;
  avg_jeonsae_rate?: number | null;
  avg_land_price_per_pyeong?: number | null;
  ask_count?: number | null;
  ask_min_price?: number | null;
  ask_initial_investment?: number | null;
  mixed_price?: number | null;
  dandok_price?: number | null;
  constructors?: string | string[] | null;
  total_households?: number | null;
  general_sale_households?: number | null;
  last_progress_done_at?: string | null;
  land_ratio_mixed?: number | null;
  land_ratio_dandok?: number | null;
  land_ratio_keunrin?: number | null;
  station_area_pct_350?: number | null;
  station_area_pct_500?: number | null;
};

export type DistrictSyncResult = {
  code: string;
  name?: string;
  fetched?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  skippedManual?: number;
  markedMissing?: number;
  restored?: number;
  warning?: string;
  error?: string;
};

export type JaegebalSyncStatus = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  codes: string[];
  results: DistrictSyncResult[];
  /** 보안 확인(403/405)에 걸려 중단됨 — 재시도하지 않는다. */
  blocked: string | null;
  /** 느린 순차 모드(구 4개 이상/전체)로 실행 중인지. */
  all: boolean;
  /** 실행 주체: 관리자가 지금 실행(manual) / 자동 업데이트 설정(auto). */
  trigger: "manual" | "auto";
  /** 기존 구역의 단계·사업유형 변화(최대 MAX_CHANGE_LOG건). */
  changes: Array<{ key: string; name: string; field: "stage" | "projectType" | "new" | "missing" | "restored" | "stats"; from?: string | null; to?: string | null }>;
};

class BlockedError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decryptEnc(enc: string): unknown {
  const key = Buffer.from(crypto.hkdfSync("sha256", SIGNING_KEY, DEVICE_ID, "jaegebal-enc-v1", 32));
  const raw = Buffer.from(enc, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
}

async function apiGet<T>(path: string, query?: string): Promise<T> {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac("sha256", SIGNING_KEY).update(`${ts}|GET|${path}|${BEHAVIOR}`).digest("hex") + "." + BEHAVIOR;
  const res = await fetch(`${API_BASE}${path}${query ? `?${query}` : ""}`, {
    headers: {
      accept: "application/json",
      referer: "https://jaegebal.com/",
      "user-agent": USER_AGENT,
      "x-jdc-app-token": APP_TOKEN,
      "x-jdc-device-id": DEVICE_ID,
      "x-jdc-timestamp": ts,
      "x-jdc-signature": sig,
    },
  });
  if (res.status === 403 || res.status === 405) {
    throw new BlockedError(`${path} -> ${res.status} waf=${res.headers.get("x-amzn-waf-action") ?? ""}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  const body = (await res.json()) as { _enc?: string };
  return (body && typeof body === "object" && body._enc ? decryptEnc(body._enc) : body) as T;
}

/** 구역 상세 페이지(HTML)를 브라우저 문서 요청과 같은 헤더로 받는다(쿠키만 제외, 2026-10-31 Railway에서 200 확인). */
async function fetchDetailHtml(developId: string): Promise<string> {
  const res = await fetch(`https://jaegebal.com/develops/${developId}`, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "accept-language": "ko-KR,ko;q=0.9,id-ID;q=0.8,id;q=0.7,en-US;q=0.6,en;q=0.5",
      "cache-control": "max-age=0",
      priority: "u=0, i",
      "sec-ch-ua": '"Google Chrome";v="155", "Chromium";v="155", "Not(A:Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "same-origin",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "user-agent": USER_AGENT,
    },
  });
  if (res.status === 403 || res.status === 405) {
    throw new BlockedError(`/develops/${developId} -> ${res.status} waf=${res.headers.get("x-amzn-waf-action") ?? ""}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} /develops/${developId}`);
  return res.text();
}

function flatPoints(a: unknown, out: number[][] = []): number[][] {
  if (Array.isArray(a) && typeof a[0] === "number") out.push(a as number[]);
  else if (Array.isArray(a)) a.forEach((x) => flatPoints(x, out));
  return out;
}

/** 바깥 고리 → 6자리 반올림, 닫힘 점 제거(기존 import와 동일 규칙). 3점 미만이면 null. */
function ringToPolygon(ring: number[][] | undefined): RedevelopmentPoint[] | null {
  if (!Array.isArray(ring)) return null;
  const pts = ring.map((p) => ({ lat: Math.round(p[1] * 1e6) / 1e6, lng: Math.round(p[0] * 1e6) / 1e6 }));
  if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng) pts.pop();
  return pts.length >= 3 ? pts : null;
}

/** 응답의 구역 지표 → 저장 형식(프론트 `ZoneStats`의 짧은 키). 값이 없는(null) 항목은 넣지 않는다. */
export function toZoneStats(item: RawDevelop): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v == null || (Array.isArray(v) && v.length === 0) || v === "") return;
    out[k] = v;
  };
  put("s", item.num_sedaes);
  put("o", item.num_owners);
  if (item.building_oldness_pct != null) out.od = [item.building_oldness_pct, item.building_oldness_pct_5y ?? null, item.building_oldness_pct_10y ?? null];
  put("zr", item.land_zoning_ratios);
  put("jr", item.avg_jeonsae_rate);
  put("lp", item.avg_land_price_per_pyeong);
  put("ac", item.ask_count);
  put("am", item.ask_min_price);
  put("ai", item.ask_initial_investment);
  put("mp", item.mixed_price);
  put("dp", item.dandok_price);
  put("c", item.constructors);
  put("th", item.total_households);
  put("gs", item.general_sale_households);
  put("d", item.last_progress_done_at);
  if (item.land_ratio_mixed != null || item.land_ratio_dandok != null || item.land_ratio_keunrin != null) {
    out.lr = [item.land_ratio_mixed ?? null, item.land_ratio_dandok ?? null, item.land_ratio_keunrin ?? null];
  }
  if (item.station_area_pct_350 != null || item.station_area_pct_500 != null) out.st = [item.station_area_pct_350 ?? null, item.station_area_pct_500 ?? null];
  put("ds", (item.detail_stage ?? "").trim());
  return out;
}

/** 이력에 남기는 주요 지표(잘 바뀌지 않는 값만). 호가·전세가율·평균가처럼 매번 움직이는 값은 이력에 남기지 않는다. */
const TRACKED_STATS: Array<[key: string, label: string, unit: string]> = [
  ["s", "세대수", "세대"],
  ["o", "소유자", "명"],
  ["c", "시공사", ""],
  ["th", "총 세대", "세대"],
  ["gs", "일반분양", "세대"],
  ["d", "최근 진행 완료일", ""],
];

/** 기존 지표에 값이 있고 새 값과 다른 주요 항목만 "세대수 1,162세대 · 시공사 -" 형태로 요약한다. 기존 값이 없던 항목(첫 채움)은 변경으로 보지 않는다. */
export function diffTrackedStats(prev: Record<string, unknown> | null, fresh: Record<string, unknown>): { from: string; to: string } | null {
  if (!prev) return null;
  const show = (v: unknown, unit: string) => (v == null || v === "" ? "-" : `${typeof v === "number" ? v.toLocaleString("ko-KR") : Array.isArray(v) ? v.join(", ") : String(v)}${unit}`);
  const from: string[] = [];
  const to: string[] = [];
  for (const [key, label, unit] of TRACKED_STATS) {
    if (!(key in prev) || !(key in fresh)) continue;
    if (JSON.stringify(prev[key]) === JSON.stringify(fresh[key])) continue;
    from.push(`${label} ${show(prev[key], unit)}`);
    to.push(`${label} ${show(fresh[key], unit)}`);
  }
  return from.length ? { from: from.join(" · "), to: to.join(" · ") } : null;
}

/** 재개발닷컴 구역 하나 → 구역 레코드들. 하위 폴리곤이 여럿이면 기존 import처럼 폴리곤마다 별도 구역
 * (첫 번째 `jaegebal-<id>`, 이후 `jaegebal-<id>-2`… 이름 뒤에 `(2)`…). */
export function toZoneRecords(item: RawDevelop) {
  const title = (item.title ?? "").trim();
  const region = SEOUL_DISTRICT_NAMES[item.region_code ?? ""] ?? "";
  const out: Array<{ key: string; name: string; region: string; projectType: string; stage: string; polygon: RedevelopmentPoint[] }> = [];
  (item.areas ?? []).forEach((subPolygon, idx) => {
    const polygon = ringToPolygon(subPolygon?.[0]);
    if (!polygon || !title) return;
    out.push({
      key: idx === 0 ? `${DATASET_ID}-${item.id}` : `${DATASET_ID}-${item.id}-${idx + 1}`,
      name: idx === 0 ? title : `${title} (${idx + 1})`,
      region,
      projectType: (item.type_display_name ?? "").trim(),
      stage: (item.detail_stage ?? "").trim(),
      polygon,
    });
  });
  return out;
}

/** 좌표 6자리 반올림 방식 차이(최대 약 10cm)는 같은 경계로 본다. */
const POINT_EPS = 2e-6;
const samePolygon = (a: RedevelopmentPoint[], b: RedevelopmentPoint[]) =>
  a.length === b.length && a.every((p, i) => Math.abs(p.lat - b[i].lat) <= POINT_EPS && Math.abs(p.lng - b[i].lng) <= POINT_EPS);
/** 앞뒤 공백 차이는 변경으로 보지 않는다(기존 import 데이터에 공백이 섞여 있음). */
const norm = (s: string | null | undefined) => (s ?? "").trim();

/** 재개발닷컴(jaegebal.com) 구역을 **지정한 구만** 가져와 DB에 반영한다(관리자 요청 시에만, 자동 스케줄 없음).
 * 새 구역은 추가, 기존 구역은 단계·사업유형·경계를 갱신, 이번 수집에 없는 구역은 삭제하지 않고 `missingSince`만 표시한다. */
@Injectable()
export class JaegebalZoneSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JaegebalZoneSyncService.name);
  private status: JaegebalSyncStatus = { running: false, startedAt: null, finishedAt: null, codes: [], results: [], blocked: null, all: false, trigger: "manual", changes: [] };
  private autoTimer?: ReturnType<typeof setInterval>;
  private autoBusy = false;

  /** 서버가 시작될 때 `running`으로 남은 실행은 이전 프로세스가 재시작으로 끊긴 것이므로 "중단됨"으로 정리한다(진행 중 결과는 구마다 저장돼 있다). */
  async onModuleInit() {
    try {
      const stale = await this.runs.find({ where: { state: "running" } });
      for (const r of stale) {
        await this.runs.update(r.id, { state: "interrupted", finishedAt: new Date() });
        const done = ((r.results ?? []) as DistrictSyncResult[]).filter((x) => x.fetched != null || x.warning).length;
        await this.notify(
          [
            `⛔ 재개발닷컴 구역 ${r.triggeredBy === "auto" ? "자동" : "수동"} 업데이트가 서버 재시작으로 중단되었습니다`,
            `진행: ${done}/${(r.codes ?? []).length}개 구 (${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(r.startedAt))} 시작)`,
            "다시 실행하면 이미 끝낸 구는 건너뛰고 이어서 합니다.",
          ].join("\n"),
        );
      }
      if (stale.length) this.logger.warn(`재시작으로 중단된 구역 업데이트 ${stale.length}건을 정리했습니다.`);
    } catch (e) {
      this.logger.error(`중단된 구역 업데이트 정리 실패: ${e}`);
    }
    this.autoTimer = setInterval(() => void this.tickAuto().catch((e) => this.logger.error(`구역 자동 업데이트 확인 실패: ${e}`)), AUTO_TICK_MS);
  }

  onModuleDestroy() {
    if (this.autoTimer) clearInterval(this.autoTimer);
  }

  /** 이번 실행의 이력 기록(실행 행 id·아직 저장 안 된 변경·종류별 건수). 이력 저장 실패가 수집 자체를 막지 않게 모두 try/catch로 감싼다. */
  private runId: string | null = null;
  private pending: RedevelopmentZoneChange[] = [];
  private counts: Record<ZoneChangeType, number> = { new: 0, stage: 0, projectType: 0, missing: 0, restored: 0, stats: 0 };

  constructor(
    @InjectRepository(RedevelopmentZone) private readonly zones: Repository<RedevelopmentZone>,
    @InjectRepository(RedevelopmentZoneSyncRun) private readonly runs: Repository<RedevelopmentZoneSyncRun>,
    @InjectRepository(RedevelopmentZoneChange) private readonly changes: Repository<RedevelopmentZoneChange>,
    @InjectRepository(RedevelopmentZoneAutoSync) private readonly autoRepo: Repository<RedevelopmentZoneAutoSync>,
    private readonly telegram: TelegramAlertService,
  ) {}

  getStatus(): JaegebalSyncStatus {
    return this.status;
  }

  /** 지정한 구(또는 `all=true`면 서울 25개 구 전체)를 업데이트한다. 구가 3개를 넘으면 자동으로 느린 간격(요청 60초·구 사이 120초)을 쓴다. */
  async start(codes: string[], force = false, all = false, triggeredBy: "manual" | "auto" = "manual"): Promise<JaegebalSyncStatus> {
    if (this.status.running) return this.status;
    const list = all ? Object.keys(SEOUL_DISTRICT_NAMES) : Array.from(new Set((codes ?? []).map((c) => String(c).trim())));
    if (!list.length) throw new BadRequestException("수집할 구 코드를 지정하세요. (예: 11560)");
    if (list.some((c) => !SEOUL_DISTRICT_NAMES[c])) throw new BadRequestException("알 수 없는 구 코드가 있습니다.");
    const slow = all || list.length > MAX_DISTRICTS_PER_RUN;
    const startedAt = new Date();
    this.status = { running: true, startedAt: startedAt.toISOString(), finishedAt: null, codes: list, results: [], blocked: null, all: slow, trigger: triggeredBy, changes: [] };
    this.pending = [];
    this.counts = { new: 0, stage: 0, projectType: 0, missing: 0, restored: 0, stats: 0 };
    this.runId = null;
    try {
      this.runId = (await this.runs.save(this.runs.create({ startedAt, state: "running", triggeredBy, codes: list, results: [] }))).id;
    } catch (e) {
      this.logger.error(`구역 업데이트 실행 기록 생성 실패(수집은 계속): ${e}`);
    }
    void this.run(list, force, slow).catch((e) => this.logger.error(`재개발닷컴 구역 수집 실패: ${e}`));
    return this.status;
  }

  /** "구역도 업데이트" 탭 상단 요약 — 재개발닷컴 구역 수·사라진 구역 수·마지막 반영·마지막 성공 업데이트(가벼운 집계만, 폴리곤을 싣지 않는다). */
  async getZoneSummary() {
    const agg = await this.zones
      .createQueryBuilder("z")
      .select("COUNT(*)", "total")
      .addSelect("MAX(z.updatedAt)", "lastUpdatedAt")
      .where("z.sourceDatasetId = :d", { d: DATASET_ID })
      .getRawOne<{ total: string | number; lastUpdatedAt: Date | string | null }>();
    const missing = await this.zones
      .createQueryBuilder("z")
      .where("z.sourceDatasetId = :d", { d: DATASET_ID })
      .andWhere("z.missingSince IS NOT NULL")
      .getCount();
    const lastRun = await this.runs.findOne({ where: { state: "done" }, order: { startedAt: "DESC" } });
    return {
      zoneCount: Number(agg?.total ?? 0),
      missingCount: missing,
      lastUpdatedAt: agg?.lastUpdatedAt ? new Date(agg.lastUpdatedAt) : null,
      lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? null,
    };
  }

  /** 업데이트 실행 목록(최신순). 변경이 없던 실행도 포함한다. */
  async listRuns(limit = 100) {
    const n = Math.min(Math.max(Math.floor(limit) || 100, 1), 300);
    return this.runs.find({ order: { startedAt: "DESC" }, take: n });
  }

  /** 한 번의 업데이트 실행과 그때 바뀐 구역 목록. */
  async getRun(id: string) {
    const run = await this.runs.findOne({ where: { id } });
    if (!run) throw new NotFoundException("업데이트 기록을 찾을 수 없습니다.");
    const changes = await this.changes.find({ where: { runId: id }, order: { region: "ASC", changeType: "ASC", zoneName: "ASC" }, take: 5000 });
    return { run, changes };
  }

  /** 한 구역의 변경 이력(최신순) — 구역 키 예: jaegebal-4296. */
  async getZoneHistory(zoneKey: string) {
    return this.changes.find({ where: { zoneKey }, order: { changedAt: "DESC" }, take: 200 });
  }

  /** 아직 저장 안 된 변경을 이력 테이블에 쌓는다(누적, 삭제 없음). */
  private async flushChanges() {
    if (!this.runId || !this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    try {
      await this.changes.save(batch, { chunk: 200 });
    } catch (e) {
      this.logger.error(`구역 변경 이력 저장 실패(${batch.length}건): ${e}`);
    }
  }

  private async finalizeRun() {
    if (!this.runId) return;
    try {
      await this.flushChanges();
      const hasError = this.status.results.some((r) => r.error);
      await this.runs.update(this.runId, {
        finishedAt: new Date(),
        state: this.status.blocked ? "blocked" : hasError ? "failed" : "done",
        results: this.status.results,
        blocked: this.status.blocked,
        newCount: this.counts.new,
        stageCount: this.counts.stage,
        typeCount: this.counts.projectType,
        missingCount: this.counts.missing,
        restoredCount: this.counts.restored,
        statsCount: this.counts.stats,
      });
    } catch (e) {
      this.logger.error(`구역 업데이트 실행 기록 마무리 실패: ${e}`);
    }
  }

  /** 진행 상황(구별 결과·건수)을 실행 행에 저장한다 — 전체 순차처럼 오래 걸리는 실행이 중간에 끊겨도 어디까지 했는지 남는다. */
  private async saveProgress() {
    if (!this.runId) return;
    try {
      await this.runs.update(this.runId, {
        results: this.status.results,
        newCount: this.counts.new,
        stageCount: this.counts.stage,
        typeCount: this.counts.projectType,
        missingCount: this.counts.missing,
        restoredCount: this.counts.restored,
        statsCount: this.counts.stats,
      });
    } catch (e) {
      this.logger.error(`구역 업데이트 진행 저장 실패: ${e}`);
    }
  }

  /** 최근 MIN_RESYNC_HOURS 안에 성공적으로 수집한 구 코드 — 메모리뿐 아니라 DB 실행 기록으로도 판단해 서버가 재시작돼도 다시 요청하지 않는다. */
  private async recentlySyncedCodes(): Promise<Set<string>> {
    const out = new Set<string>();
    for (const code of this.lastSyncAt.keys()) if (this.syncedRecently(code)) out.add(code);
    try {
      const rows = await this.runs.find({ where: { startedAt: MoreThan(new Date(Date.now() - MIN_RESYNC_HOURS * 3600_000)) } });
      for (const row of rows) {
        for (const r of (row.results ?? []) as DistrictSyncResult[]) if (r?.code && r.fetched != null && !r.error) out.add(r.code);
      }
    } catch (e) {
      this.logger.error(`최근 수집 기록 조회 실패(메모리 기준으로 판단): ${e}`);
    }
    return out;
  }

  private async run(codes: string[], force: boolean, all = false) {
    // 전체 순차 모드는 더 천천히: 구 안에서 60초, 구와 구 사이 120초. 기본 모드는 모두 30초.
    const innerGap = all ? ALL_REQUEST_GAP_MS : REQUEST_GAP_MS;
    const districtGap = all ? ALL_DISTRICT_GAP_MS : REQUEST_GAP_MS;
    try {
      let requested = false;
      let consecutiveErrors = 0;
      const recent = force ? new Set<string>() : await this.recentlySyncedCodes();
      for (const code of codes) {
        const result: DistrictSyncResult = { code };
        this.status.results.push(result);
        try {
          if (recent.has(code)) {
            result.warning = `최근 ${MIN_RESYNC_HOURS}시간 안에 이 구를 이미 수집해서 건너뜁니다.`;
            await this.saveProgress();
            continue;
          }
          if (requested) await sleep(districtGap);
          requested = true;
          const region = await apiGet<{ name: string; rings: unknown }>(`/common/regions/${code}`);
          result.name = region.name;
          const pts = flatPoints(region.rings);
          const lngs = pts.map((p) => p[0]);
          const lats = pts.map((p) => p[1]);
          if (!pts.length) throw new Error("구 경계 정보가 비어 있습니다.");
          const query =
            `min_lat=${Math.min(...lats) - BOX_MARGIN}&max_lat=${Math.max(...lats) + BOX_MARGIN}` +
            `&min_lng=${Math.min(...lngs) - BOX_MARGIN}&max_lng=${Math.max(...lngs) + BOX_MARGIN}` +
            `&simplify=0.0001&include_completed=true`;
          await sleep(innerGap);
          const items = (await apiGet<RawDevelop[]>("/develops", query)).filter((x) => Array.isArray(x.areas) && x.areas.length);
          await this.apply(region.name, items, result);
          await this.flushChanges();
          this.lastSyncAt.set(code, Date.now());
          consecutiveErrors = 0;
          await this.saveProgress();
        } catch (e) {
          if (e instanceof BlockedError) {
            this.status.blocked = e.message;
            result.error = "보안 확인에 걸려 중단했습니다(재시도하지 않음).";
            return;
          }
          result.error = String(e instanceof Error ? e.message : e);
          consecutiveErrors += 1;
          await this.saveProgress();
          // 전체 순차 모드에서는 구 오류가 연달아 나면 사이트 상태가 이상한 것이므로 더 두드리지 않고 멈춘다.
          if (all && consecutiveErrors >= ALL_MAX_CONSECUTIVE_ERRORS) {
            this.logger.warn(`전체 순차 업데이트: 구 오류가 ${consecutiveErrors}번 연속 발생해 중단합니다.`);
            return;
          }
        }
      }
    } finally {
      await this.finalizeRun(); // 이력 저장을 끝낸 뒤 running=false로 바꿔, 화면이 곧바로 이력을 조회해도 최신이다.
      const snapshot = { st: this.status, counts: { ...this.counts }, finishedAt: new Date() }; // 다음 실행이 시작돼도 섞이지 않게 지금 값을 고정
      this.status.running = false;
      this.status.finishedAt = snapshot.finishedAt.toISOString();
      let nextRunAt: Date | null = null;
      if (snapshot.st.trigger === "auto") nextRunAt = await this.finishAutoRun(snapshot.st).catch((e) => (this.logger.error(`자동 업데이트 마무리 실패: ${e}`), null));
      await this.notify(this.buildReport(snapshot.st, snapshot.counts, snapshot.finishedAt, nextRunAt)); // 수동·자동 모두 텔레그램으로 결과를 알린다
    }
  }

  // ── 자동 업데이트(설정·스케줄러) ──────────────────────────────────────────────

  private async loadAuto(): Promise<RedevelopmentZoneAutoSync> {
    const row = await this.autoRepo.findOne({ where: { id: AUTO_ID } });
    return (
      row ??
      this.autoRepo.create({
        id: AUTO_ID,
        enabled: false,
        intervalDays: AUTO_DEFAULT_INTERVAL_DAYS,
        runHour: AUTO_DEFAULT_RUN_HOUR,
        runMinute: AUTO_DEFAULT_RUN_MINUTE,
        codes: [],
        lastRunAt: null,
        nextRunAt: null,
      })
    );
  }

  async getAutoSettings() {
    const r = await this.loadAuto();
    return { enabled: r.enabled, intervalDays: r.intervalDays, runHour: r.runHour, runMinute: r.runMinute, codes: r.codes ?? [], lastRunAt: r.lastRunAt, nextRunAt: r.nextRunAt };
  }

  /** 자동 업데이트 설정 저장(켜기/끄기·주기(일)·실행 시각·대상 구). 켜면 다음 실행 시각 = (켠 날) + 주기일의 실행 시각. */
  async saveAutoSettings(input: { enabled?: boolean; intervalDays?: number; runHour?: number; runMinute?: number; codes?: string[] }) {
    const cur = await this.loadAuto();
    const enabled = input.enabled ?? cur.enabled;
    const intervalDays = input.intervalDays ?? cur.intervalDays;
    const runHour = input.runHour ?? cur.runHour;
    const runMinute = input.runMinute ?? cur.runMinute;
    const codes = input.codes ? Array.from(new Set(input.codes.map((c) => String(c).trim()))) : (cur.codes ?? []);
    if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 365) throw new BadRequestException("업데이트 주기는 1~365일의 정수여야 합니다.");
    if (!Number.isInteger(runHour) || runHour < 0 || runHour > 23 || !Number.isInteger(runMinute) || runMinute < 0 || runMinute > 59) {
      throw new BadRequestException("실행 시각은 한국시간 00:00~23:59여야 합니다.");
    }
    if (codes.some((c) => !SEOUL_DISTRICT_NAMES[c])) throw new BadRequestException("알 수 없는 구 코드가 있습니다.");
    if (enabled && !codes.length) throw new BadRequestException("자동 업데이트할 구를 먼저 선택하세요.");
    const now = new Date();
    let nextRunAt = cur.nextRunAt;
    if (!enabled) {
      nextRunAt = null;
    } else if (!cur.enabled) {
      // 지금 켠다 → 켠 날로부터 주기일 뒤 그 시각(예: 14일 후 03:00)
      nextRunAt = nextRunTime(now, intervalDays, runHour, runMinute);
    } else if (cur.intervalDays !== intervalDays || cur.runHour !== runHour || cur.runMinute !== runMinute || !cur.nextRunAt) {
      // 이미 켜져 있는데 주기·시각을 바꿈 → 마지막 자동 실행(없으면 지금) 기준으로 다시 계산, 이미 지난 시각이면 지금 기준
      const fromLast = nextRunTime(cur.lastRunAt ?? now, intervalDays, runHour, runMinute);
      nextRunAt = fromLast.getTime() > now.getTime() ? fromLast : nextRunTime(now, intervalDays, runHour, runMinute);
    }
    const saved = await this.autoRepo.save(Object.assign(cur, { enabled, intervalDays, runHour, runMinute, codes, nextRunAt }));
    return { enabled: saved.enabled, intervalDays: saved.intervalDays, runHour: saved.runHour, runMinute: saved.runMinute, codes: saved.codes, lastRunAt: saved.lastRunAt, nextRunAt: saved.nextRunAt };
  }

  /** 1분마다: 자동 업데이트가 켜져 있고 예정 시각이 지났으며 다른 실행이 없으면 실행을 시작한다. */
  async tickAuto(now = new Date()): Promise<void> {
    if (this.status.running || this.autoBusy) return;
    const row = await this.autoRepo.findOne({ where: { id: AUTO_ID } });
    if (!row || !row.enabled || !row.codes?.length || !row.nextRunAt || row.nextRunAt.getTime() > now.getTime()) return;
    this.autoBusy = true;
    try {
      await this.start(row.codes, false, false, "auto");
    } catch (e) {
      // 시작 자체가 실패하면 1분마다 되풀이하지 않도록 하루 뒤로 미룬다.
      this.logger.error(`구역 자동 업데이트 시작 실패: ${e}`);
      row.nextRunAt = new Date(now.getTime() + AUTO_RETRY_AFTER_FAILURE_MS);
      await this.autoRepo.save(row);
      await this.notify(`❌ 재개발닷컴 구역 자동 업데이트를 시작하지 못했습니다\n사유: ${e instanceof Error ? e.message : String(e)}\n하루 뒤 다시 시도합니다.`);
    } finally {
      this.autoBusy = false;
    }
  }

  /** 자동 실행이 끝나면 마지막 실행·다음 예정 시각을 갱신한다(실패하면 하루 뒤 한 번 다시 시도). 다음 예정 시각을 돌려준다. */
  private async finishAutoRun(st: JaegebalSyncStatus): Promise<Date | null> {
    const row = await this.loadAuto();
    const failed = !!st.blocked || st.results.some((r) => r.error);
    const now = new Date();
    const started = st.startedAt ? new Date(st.startedAt) : now;
    row.lastRunAt = started;
    row.nextRunAt = row.enabled ? (failed ? new Date(now.getTime() + AUTO_RETRY_AFTER_FAILURE_MS) : nextRunTime(started, row.intervalDays, row.runHour, row.runMinute)) : null;
    await this.autoRepo.save(row);
    return row.nextRunAt;
  }

  /** 텔레그램(REDEVELOPMENT_TELEGRAM_CHAT_ID, 없으면 기본 채널)으로 보낸다. 전송 실패가 업데이트를 막지 않는다. */
  private async notify(text: string) {
    try {
      await this.telegram.send(text, process.env.REDEVELOPMENT_TELEGRAM_CHAT_ID?.trim() || undefined);
    } catch (e) {
      this.logger.error(`구역 업데이트 텔레그램 알림 실패: ${e}`);
    }
  }

  /** 업데이트 결과 알림 본문 — 수동·자동 공통. 성공하면 구·구역 건수와 변경 요약, 실패하면 어느 구가 왜 실패했는지. */
  private buildReport(st: JaegebalSyncStatus, counts: Record<ZoneChangeType, number>, finishedAt: Date, nextRunAt: Date | null): string {
    const kind = st.trigger === "auto" ? "자동" : "수동";
    const fmt = (d: Date) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
    const nameOf = (r: DistrictSyncResult) => r.name ?? SEOUL_DISTRICT_NAMES[r.code] ?? r.code;
    const ok = st.results.filter((r) => r.fetched != null && !r.error);
    const failedRows = st.results.filter((r) => r.error);
    const skipped = st.results.filter((r) => r.warning && r.fetched == null && !r.error);
    const hasProblem = !!st.blocked || failedRows.length > 0;
    const started = st.startedAt ? new Date(st.startedAt) : finishedAt;
    const secs = Math.max(0, Math.round((finishedAt.getTime() - started.getTime()) / 1000));
    const took = secs >= 60 ? `${Math.floor(secs / 60)}분 ${secs % 60}초` : `${secs}초`;
    const icon = st.blocked ? "⛔" : hasProblem ? "⚠️" : ok.length ? "✅" : "ℹ️";
    const title = st.blocked ? "중단(보안 확인)" : hasProblem ? "일부 오류" : ok.length ? "완료" : "건너뜀";
    const total = ok.reduce((n, r) => n + (r.fetched ?? 0), 0);
    const lines = [`${icon} 재개발닷컴 구역 ${kind} 업데이트 ${title}`];
    lines.push(`대상 ${st.codes.length}개 구: ${st.codes.map((c) => SEOUL_DISTRICT_NAMES[c] ?? c).join(", ")} · 소요 ${took}`);
    if (ok.length) {
      lines.push(`${ok.length}개 구에서 구역 ${total.toLocaleString("ko-KR")}건 확인 · 신규 ${counts.new} · 단계 변경 ${counts.stage} · 사업유형 변경 ${counts.projectType} · 사라짐 ${counts.missing} · 복구 ${counts.restored}${counts.stats ? ` · 주요 지표 변경 ${counts.stats}` : ""}`);
      const stageChanges = st.changes.filter((c) => c.field === "stage");
      for (const c of stageChanges.slice(0, 5)) lines.push(`• ${c.name}: ${c.from || "-"} → ${c.to || "-"}`);
      if (counts.stage > 5) lines.push(`  …외 단계 변경 ${counts.stage - 5}건 (구역 업데이트 이력 탭에서 확인)`);
    }
    if (skipped.length) lines.push(`건너뜀: ${skipped.map(nameOf).join(", ")} (최근 ${MIN_RESYNC_HOURS}시간 안에 이미 수집)`);
    // 보안 확인 중단은 아래 안내 한 줄로 충분하므로 구별 오류 줄에서는 뺀다.
    for (const r of failedRows.filter((x) => !(st.blocked && x.error?.includes("보안 확인"))).slice(0, 5)) lines.push(`❌ ${nameOf(r)}: ${r.error}`);
    if (st.blocked) lines.push(`사이트 보안 확인에 걸려 전체를 멈췄습니다(${st.blocked}). 우회하지 않고 멈췄으니 몇 시간 뒤 다시 시도하세요.`);
    const notDone = st.codes.length - st.results.length;
    if (notDone > 0 && hasProblem) lines.push(`처리하지 못한 구 ${notDone}개`);
    if (st.trigger === "auto") {
      lines.push(hasProblem ? `하루 뒤 한 번 다시 시도합니다${nextRunAt ? ` (${fmt(nextRunAt)})` : ""}.` : nextRunAt ? `다음 자동 업데이트: ${fmt(nextRunAt)}` : "");
    }
    return lines.filter((l) => l !== "").join("\n");
  }

  /** 같은 구를 연달아 다시 요청하지 않도록 구 코드별 마지막 수집 시각을 메모리에 둔다(서버 재시작 시 초기화). */
  private readonly lastSyncAt = new Map<string, number>();

  /** 권리산정기준일을 서버가 재개발닷컴 상세 페이지(HTML)에서 직접 읽어 저장한다(2026-10-31, 브라우저 방식 대체).
   * 페이지 안의 `right_basedate`·`right_date_zones` 값을 읽는다. 403/405는 우회하지 않고 멈춘다. 같은 구역은 연달아 요청하지 않는다. */
  async fetchRightDate(zoneId: string) {
    const zone = await this.zones.findOne({ where: { id: zoneId } });
    const id = /^jaegebal-(\d+)/.exec(zone?.sourceKey ?? "")?.[1];
    if (!zone || !id) throw new BadRequestException("재개발닷컴에서 가져온 구역만 권리산정기준일을 확인할 수 있습니다.");
    const last = this.lastRightDateAt.get(id);
    if (last != null && Date.now() - last < RIGHT_DATE_MIN_GAP_MS) throw new BadRequestException("방금 확인한 구역입니다. 잠시 뒤 다시 눌러 주세요.");
    this.lastRightDateAt.set(id, Date.now());
    let html: string;
    try {
      html = await fetchDetailHtml(id);
    } catch (e) {
      if (e instanceof BlockedError) throw new BadRequestException("재개발닷컴 보안 확인에 걸렸습니다. 우회하지 않고 멈췄으니 몇 시간 뒤 다시 시도하세요.");
      throw new BadRequestException(`재개발닷컴 상세 페이지를 받지 못했습니다: ${(e as Error).message}`);
    }
    const text = html.replace(/\\"/g, '"');
    const b = /"right_basedate":(null|"(\d{4}-\d{2}-\d{2})")/.exec(text);
    if (!b) throw new BadRequestException("상세 페이지에서 권리산정기준일 정보를 찾지 못했습니다.");
    let rz: Array<{ d: string; n?: string | null }> = [];
    const z = /"right_date_zones":(\[[^\]]*\])/.exec(text);
    if (z) {
      try {
        rz = (JSON.parse(z[1]) as Array<{ right_date?: string; name?: string | null }>).map((x) => ({ d: x.right_date as string, n: x.name }));
      } catch {
        rz = [];
      }
    }
    return this.saveRightDate(zoneId, { developId: id, rb: b[2] ?? null, rz });
  }

  private readonly lastRightDateAt = new Map<string, number>();

  /** 권리산정기준일 저장: 구역 지표(`stats`)에 `rb`·`rz`·`rf`로 저장한다. */
  async saveRightDate(zoneId: string, body: { developId?: string; rb?: string | null; rz?: Array<{ d?: string; n?: string | null }> }) {
    const zone = await this.zones.findOne({ where: { id: zoneId } });
    const id = /^jaegebal-(\d+)/.exec(zone?.sourceKey ?? "")?.[1];
    if (!zone || !id) throw new BadRequestException("재개발닷컴에서 가져온 구역만 권리산정기준일을 저장할 수 있습니다.");
    if (String(body?.developId ?? "") !== id) throw new BadRequestException("열어 본 재개발닷컴 페이지가 이 구역과 다릅니다. 이 구역의 상세 페이지에서 다시 눌러 주세요.");
    const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (body.rb != null && !isDate(body.rb)) throw new BadRequestException("권리산정기준일 형식이 올바르지 않습니다.");
    const rb = body.rb ?? null;
    const rz = (Array.isArray(body.rz) ? body.rz : [])
      .filter((z) => isDate(z?.d) && z.d !== rb)
      .slice(0, 20)
      .map((z) => ({ d: z.d as string, n: typeof z.n === "string" ? z.n.slice(0, 60) : null }));
    const rf = new Date().toISOString();
    zone.stats = { ...(zone.stats ?? {}), rb, rz, rf };
    await this.zones.save(zone);
    return { rb, rz, rf };
  }

  private syncedRecently(code: string): boolean {
    const at = this.lastSyncAt.get(code);
    return at != null && Date.now() - at < MIN_RESYNC_HOURS * 3600_000;
  }

  private pushChange(c: JaegebalSyncStatus["changes"][number], region: string) {
    if (this.status.changes.length < MAX_CHANGE_LOG) this.status.changes.push(c);
    this.counts[c.field] += 1;
    if (this.runId) {
      this.pending.push(
        this.changes.create({
          runId: this.runId,
          changedAt: new Date(),
          zoneKey: c.key,
          zoneName: c.name,
          region,
          changeType: c.field,
          fromValue: c.from ?? null,
          toValue: c.to ?? null,
        }),
      );
    }
  }

  private async apply(regionName: string, items: RawDevelop[], result: DistrictSyncResult) {
    const now = new Date();
    const seenKeys = new Set<string>();
    result.fetched = items.length;
    result.created = result.updated = result.unchanged = result.skippedManual = result.restored = 0;

    for (const item of items) {
      const freshStats = toZoneStats(item);
      for (const rec of toZoneRecords(item)) {
        seenKeys.add(rec.key);
        const existing = await this.zones.findOne({ where: { sourceDatasetId: DATASET_ID, sourceKey: rec.key } });
        if (!existing) {
          await this.zones.save(
            this.zones.create({
              name: rec.name,
              region: rec.region,
              stage: rec.stage,
              projectType: rec.projectType || null,
              polygon: rec.polygon,
              source: "PUBLIC_API",
              sourceDatasetId: DATASET_ID,
              sourceKey: rec.key,
              boundaryType: "EXACT",
              lastAutoSyncedAt: now,
              missingSince: null,
              stats: freshStats,
            }),
          );
          result.created += 1;
          this.pushChange({ key: rec.key, name: rec.name, field: "new", to: rec.stage }, rec.region);
          continue;
        }
        // 관리자가 직접 고친 경계는 덮어쓰지 않는다(기존 bulk-upsert와 같은 보호 규칙).
        if (existing.boundaryType === "MANUAL" && existing.lastAutoSyncedAt != null && existing.updatedAt > existing.lastAutoSyncedAt) {
          result.skippedManual += 1;
          continue;
        }
        // 지표는 응답에 값이 있는 항목만 덮어쓰고 없는 항목은 기존 값을 둔다. 경계 보호(MANUAL)와 무관하게 갱신한다.
        const mergedStats = { ...(existing.stats ?? {}), ...freshStats };
        const statsChanged = JSON.stringify(mergedStats) !== JSON.stringify(existing.stats ?? {});
        const wasMissing = existing.missingSince != null;
        const stageChanged = norm(existing.stage) !== rec.stage;
        const typeChanged = norm(existing.projectType) !== rec.projectType;
        const changed =
          wasMissing || statsChanged || stageChanged || typeChanged || norm(existing.name) !== rec.name || norm(existing.region) !== rec.region || !samePolygon(existing.polygon, rec.polygon);
        if (!changed) {
          result.unchanged += 1;
          continue;
        }
        if (stageChanged) this.pushChange({ key: rec.key, name: rec.name, field: "stage", from: norm(existing.stage), to: rec.stage }, rec.region);
        if (typeChanged) this.pushChange({ key: rec.key, name: rec.name, field: "projectType", from: norm(existing.projectType), to: rec.projectType }, rec.region);
        const statsDiff = diffTrackedStats(existing.stats, freshStats);
        if (statsDiff) this.pushChange({ key: rec.key, name: rec.name, field: "stats", from: statsDiff.from, to: statsDiff.to }, rec.region);
        if (wasMissing) {
          result.restored += 1;
          this.pushChange({ key: rec.key, name: rec.name, field: "restored" }, rec.region);
        }
        existing.name = rec.name;
        existing.region = rec.region;
        existing.stage = rec.stage;
        existing.projectType = rec.projectType || existing.projectType;
        existing.polygon = rec.polygon;
        existing.lastAutoSyncedAt = now;
        existing.missingSince = null;
        existing.stats = mergedStats;
        await this.zones.save(existing);
        result.updated += 1;
      }
    }

    await this.markMissing(regionName, seenKeys, now, result);
  }

  /** DB에는 있는데 이번 수집 응답에 없는 이 구의 구역에 `missingSince`를 찍는다(삭제 안 함). */
  private async markMissing(regionName: string, seenKeys: Set<string>, now: Date, result: DistrictSyncResult) {
    result.markedMissing = 0;
    const inDb = await this.zones.find({ where: { sourceDatasetId: DATASET_ID, region: regionName } });
    const jaegebalZones = inDb.filter((z) => z.sourceKey?.startsWith(`${DATASET_ID}-`));
    const stillSeen = jaegebalZones.filter((z) => z.sourceKey && seenKeys.has(z.sourceKey)).length;
    // 부분 응답·일시 오류로 한꺼번에 "사라짐" 표시되는 것을 막는다.
    if (jaegebalZones.length >= MISSING_SANITY_MIN_ZONES && stillSeen < jaegebalZones.length * MISSING_SANITY_RATIO) {
      result.warning = `응답에 기존 구역이 너무 적어(${stillSeen}/${jaegebalZones.length}) 사라진 구역 표시를 하지 않았습니다.`;
      return;
    }
    for (const z of jaegebalZones) {
      if (!z.sourceKey || seenKeys.has(z.sourceKey) || z.missingSince) continue;
      z.missingSince = now;
      await this.zones.save(z);
      result.markedMissing += 1;
      this.pushChange({ key: z.sourceKey, name: z.name, field: "missing", from: norm(z.stage) }, z.region);
    }
  }
}
