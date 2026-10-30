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
  changes: Array<{ key: string; name: string; field: "stage" | "projectType" | "new" | "missing" | "restored"; from?: string | null; to?: string | null }>;
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
      for (const r of stale) await this.runs.update(r.id, { state: "interrupted", finishedAt: new Date() });
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
  private counts: Record<ZoneChangeType, number> = { new: 0, stage: 0, projectType: 0, missing: 0, restored: 0 };

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
    this.counts = { new: 0, stage: 0, projectType: 0, missing: 0, restored: 0 };
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
      this.status.running = false;
      this.status.finishedAt = new Date().toISOString();
      if (this.status.trigger === "auto") await this.finishAutoRun(this.status).catch((e) => this.logger.error(`자동 업데이트 마무리 실패: ${e}`));
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
    } finally {
      this.autoBusy = false;
    }
  }

  /** 자동 실행이 끝나면 마지막 실행·다음 예정 시각을 갱신하고 텔레그램으로 결과를 알린다. 실패하면 하루 뒤 한 번 다시 시도. */
  private async finishAutoRun(st: JaegebalSyncStatus) {
    const row = await this.loadAuto();
    const failed = !!st.blocked || st.results.some((r) => r.error);
    const now = new Date();
    const started = st.startedAt ? new Date(st.startedAt) : now;
    row.lastRunAt = started;
    row.nextRunAt = row.enabled ? (failed ? new Date(now.getTime() + AUTO_RETRY_AFTER_FAILURE_MS) : nextRunTime(started, row.intervalDays, row.runHour, row.runMinute)) : null;
    await this.autoRepo.save(row);
    const names = st.codes.map((c) => SEOUL_DISTRICT_NAMES[c] ?? c).join(", ");
    const nextText = row.nextRunAt ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }).format(row.nextRunAt) : "-";
    const text = [
      `🗺️ 재개발닷컴 구역 자동 업데이트 ${st.blocked ? "중단" : failed ? "일부 오류" : "완료"}`,
      `대상 ${st.codes.length}개 구: ${names}`,
      `신규 ${this.counts.new} · 단계 변경 ${this.counts.stage} · 사업유형 변경 ${this.counts.projectType} · 사라짐 ${this.counts.missing} · 복구 ${this.counts.restored}`,
      st.blocked
        ? "사이트 보안 확인에 걸려 멈췄습니다. 하루 뒤 한 번 다시 시도합니다."
        : failed
          ? "오류가 난 구가 있습니다. 하루 뒤 다시 시도합니다."
          : `다음 자동 업데이트: ${nextText}`,
    ].join("\n");
    await this.telegram.send(text, process.env.REDEVELOPMENT_TELEGRAM_CHAT_ID?.trim() || undefined);
  }

  /** 같은 구를 연달아 다시 요청하지 않도록 구 코드별 마지막 수집 시각을 메모리에 둔다(서버 재시작 시 초기화). */
  private readonly lastSyncAt = new Map<string, number>();

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
        const wasMissing = existing.missingSince != null;
        const stageChanged = norm(existing.stage) !== rec.stage;
        const typeChanged = norm(existing.projectType) !== rec.projectType;
        const changed =
          wasMissing || stageChanged || typeChanged || norm(existing.name) !== rec.name || norm(existing.region) !== rec.region || !samePolygon(existing.polygon, rec.polygon);
        if (!changed) {
          result.unchanged += 1;
          continue;
        }
        if (stageChanged) this.pushChange({ key: rec.key, name: rec.name, field: "stage", from: norm(existing.stage), to: rec.stage }, rec.region);
        if (typeChanged) this.pushChange({ key: rec.key, name: rec.name, field: "projectType", from: norm(existing.projectType), to: rec.projectType }, rec.region);
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
