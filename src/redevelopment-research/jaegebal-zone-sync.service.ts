import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as zlib from "zlib";
import { Repository } from "typeorm";
import { RedevelopmentPoint, RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";

const DATASET_ID = "jaegebal";
const API_BASE = "https://jaegebal.com/api";
// 사이트 JS에 공개된 값. 사이트 배포로 바뀌면 환경변수로 재배포 없이 교체한다.
const SIGNING_KEY = process.env.JDC_SIGNING_KEY || "57bfe0da55e35b096fd0a4ac27ca2c35b40f13e2827442e4771c999b2cec1c74";
const APP_TOKEN = process.env.JDC_APP_TOKEN || "0418b9cadfb234a22035c05e982492cf02b62fa91bc89e217f8f93c7e6f0e10f";
const DEVICE_ID = process.env.JDC_DEVICE_ID || "web;e92feeb0-f0bd-4ca7-961c-85537a203a35";
/** 사람 행동을 흉내 내지 않는다: 활동 0, 마지막 칸 1 = 자동화 클라이언트 표시. */
const BEHAVIOR = "1.0.0.0.0.0.0.0.0.0.0.1";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

/** 최소 수집 원칙(사용자 결정, 2026-10-30): 필요한 구만, 가끔, 간격을 크게. 자동 대량 수집 금지. */
export const MAX_DISTRICTS_PER_RUN = 3;
const REQUEST_GAP_MS = 30_000;
const MIN_RESYNC_HOURS = 6;
const BOX_MARGIN = 0.002;
/** 응답이 DB에 있던 구역 수에 비해 너무 적으면(부분 응답 의심) "사라진 구역" 표시를 하지 않는다. */
const MISSING_SANITY_RATIO = 0.5;
const MISSING_SANITY_MIN_ZONES = 10;
const MAX_CHANGE_LOG = 200;

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
export class JaegebalZoneSyncService {
  private readonly logger = new Logger(JaegebalZoneSyncService.name);
  private status: JaegebalSyncStatus = { running: false, startedAt: null, finishedAt: null, codes: [], results: [], blocked: null, changes: [] };

  constructor(@InjectRepository(RedevelopmentZone) private readonly zones: Repository<RedevelopmentZone>) {}

  getStatus(): JaegebalSyncStatus {
    return this.status;
  }

  async start(codes: string[], force = false): Promise<JaegebalSyncStatus> {
    if (this.status.running) return this.status;
    const list = Array.from(new Set((codes ?? []).map((c) => String(c).trim())));
    if (!list.length) throw new BadRequestException("수집할 구 코드를 지정하세요. (예: 11560)");
    if (list.some((c) => !/^\d{5}$/.test(c))) throw new BadRequestException("구 코드는 5자리 숫자여야 합니다.");
    if (list.length > MAX_DISTRICTS_PER_RUN) throw new BadRequestException(`한 번에 최대 ${MAX_DISTRICTS_PER_RUN}개 구까지만 수집합니다.`);
    this.status = { running: true, startedAt: new Date().toISOString(), finishedAt: null, codes: list, results: [], blocked: null, changes: [] };
    void this.run(list, force).catch((e) => this.logger.error(`재개발닷컴 구역 수집 실패: ${e}`));
    return this.status;
  }

  private async run(codes: string[], force: boolean) {
    try {
      let requested = false;
      for (const code of codes) {
        const result: DistrictSyncResult = { code };
        this.status.results.push(result);
        try {
          if (!force && this.syncedRecently(code)) {
            result.warning = `최근 ${MIN_RESYNC_HOURS}시간 안에 이 구를 이미 수집해서 건너뜁니다.`;
            continue;
          }
          if (requested) await sleep(REQUEST_GAP_MS);
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
          await sleep(REQUEST_GAP_MS);
          const items = (await apiGet<RawDevelop[]>("/develops", query)).filter((x) => Array.isArray(x.areas) && x.areas.length);
          await this.apply(region.name, items, result);
          this.lastSyncAt.set(code, Date.now());
        } catch (e) {
          if (e instanceof BlockedError) {
            this.status.blocked = e.message;
            result.error = "보안 확인에 걸려 중단했습니다(재시도하지 않음).";
            return;
          }
          result.error = String(e instanceof Error ? e.message : e);
        }
      }
    } finally {
      this.status.running = false;
      this.status.finishedAt = new Date().toISOString();
    }
  }

  /** 같은 구를 연달아 다시 요청하지 않도록 구 코드별 마지막 수집 시각을 메모리에 둔다(서버 재시작 시 초기화). */
  private readonly lastSyncAt = new Map<string, number>();

  private syncedRecently(code: string): boolean {
    const at = this.lastSyncAt.get(code);
    return at != null && Date.now() - at < MIN_RESYNC_HOURS * 3600_000;
  }

  private pushChange(c: JaegebalSyncStatus["changes"][number]) {
    if (this.status.changes.length < MAX_CHANGE_LOG) this.status.changes.push(c);
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
          this.pushChange({ key: rec.key, name: rec.name, field: "new", to: rec.stage });
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
        if (stageChanged) this.pushChange({ key: rec.key, name: rec.name, field: "stage", from: existing.stage, to: rec.stage });
        if (typeChanged) this.pushChange({ key: rec.key, name: rec.name, field: "projectType", from: existing.projectType, to: rec.projectType });
        if (wasMissing) {
          result.restored += 1;
          this.pushChange({ key: rec.key, name: rec.name, field: "restored" });
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
      this.pushChange({ key: z.sourceKey, name: z.name, field: "missing", from: z.stage });
    }
  }
}
