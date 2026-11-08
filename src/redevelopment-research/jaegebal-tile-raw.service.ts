import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import * as crypto from "crypto";
import * as zlib from "zlib";
import { Repository } from "typeorm";
import { JaegebalTileRaw } from "./entities/jaegebal-tile-raw.entity";

import { tileBoxQuery } from "./tile-box";
const API_BASE = "https://jaegebal.com/api";
const SIGNING_KEY = process.env.JDC_SIGNING_KEY || "57bfe0da55e35b096fd0a4ac27ca2c35b40f13e2827442e4771c999b2cec1c74";
const APP_TOKEN = process.env.JDC_APP_TOKEN || "0418b9cadfb234a22035c05e982492cf02b62fa91bc89e217f8f93c7e6f0e10f";
/** 기존 구역 업데이트와 같은 정직한 행동값(사람 흉내 금지). */
const BEHAVIOR = "1.0.0.0.0.0.0.0.0.0.0.1";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";
const TILE_GAP_MS = 30_000;
const MAX_TILES_PER_RUN = 5;
const DEVICE_ID_RE = /^web;[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 사용자가 정한 21개 타일 [minLat, maxLat, minLng, maxLng]. 번호 = 사용자 목록의 1~21번. */
export const RAW_TILES: Record<number, [number, number, number, number]> = {
  1: [36.85, 37.05, 127.0, 127.2], 2: [37.05, 37.25, 126.6, 126.8], 3: [37.05, 37.25, 126.8, 127.0], 4: [37.05, 37.25, 127.0, 127.2],
  5: [37.05, 37.25, 127.2, 127.4], 6: [37.25, 37.45, 126.6, 126.8], 7: [37.25, 37.45, 126.8, 127.0], 8: [37.25, 37.45, 127.0, 127.2],
  9: [37.25, 37.45, 127.2, 127.4], 10: [37.25, 37.45, 127.4, 127.6], 11: [37.45, 37.65, 126.6, 126.8], 12: [37.45, 37.65, 126.8, 127.0],
  13: [37.45, 37.65, 127.0, 127.2], 14: [37.45, 37.65, 127.2, 127.4], 15: [37.65, 37.85, 126.6, 126.8], 16: [37.65, 37.85, 126.8, 127.0],
  17: [37.65, 37.85, 127.0, 127.2], 18: [37.65, 37.85, 127.2, 127.4], 19: [37.85, 38.05, 126.6, 126.8], 20: [37.85, 38.05, 127.0, 127.2],
  21: [37.85, 38.05, 127.2, 127.4],
};
const TOTAL_TILES = Object.keys(RAW_TILES).length;

export type TileRawResult = { tile: number; status?: number; count?: number; error?: string };
export type TileRawStatus = {
  running: boolean;
  from: number | null;
  to: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  results: TileRawResult[];
  /** 403/405/429로 중단된 사유. */
  blocked: string | null;
};

class StopError extends Error {}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decryptEnc(enc: string, deviceId: string): unknown {
  const key = Buffer.from(crypto.hkdfSync("sha256", SIGNING_KEY, deviceId, "jaegebal-enc-v1", 32));
  const raw = Buffer.from(enc, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  const plain = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]);
  return JSON.parse(zlib.gunzipSync(plain).toString("utf8"));
}

/** 관리자가 넣은 x-jdc-device-id로 사용자가 정한 타일(1~21번)을 서버에서 받아 DB에 저장한다. 재시도·우회 없이, 403/405/429에서 즉시 중단. */
@Injectable()
export class JaegebalTileRawService {
  private readonly logger = new Logger(JaegebalTileRawService.name);
  private status: TileRawStatus = { running: false, from: null, to: null, startedAt: null, finishedAt: null, results: [], blocked: null };

  constructor(@InjectRepository(JaegebalTileRaw) private readonly repo: Repository<JaegebalTileRaw>) {}

  getStatus(): TileRawStatus {
    return this.status;
  }

  async list() {
    const rows = await this.repo.createQueryBuilder("t").select(["t.tileNo", "t.deviceId", "t.fetchedAt", "t.status", "t.itemCount"]).orderBy("t.tileNo", "ASC").getMany();
    return { total: TOTAL_TILES, tiles: rows };
  }

  async get(tileNo: number) {
    const row = await this.repo.findOne({ where: { tileNo } });
    if (!row) throw new BadRequestException("저장된 결과가 없습니다.");
    return row;
  }

  start(deviceIdRaw: string, from: number, to: number): TileRawStatus {
    if (this.status.running) return this.status;
    const deviceId = (deviceIdRaw ?? "").trim();
    if (!DEVICE_ID_RE.test(deviceId)) throw new BadRequestException("device-id 형식이 올바르지 않습니다(예: web;xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).");
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from || to > TOTAL_TILES) {
      throw new BadRequestException(`타일 번호는 1~${TOTAL_TILES} 범위이고 끝 번호가 시작 번호 이상이어야 합니다.`);
    }
    if (to - from + 1 > MAX_TILES_PER_RUN) throw new BadRequestException(`한 번에 최대 ${MAX_TILES_PER_RUN}개 타일까지만 받습니다.`);
    this.status = { running: true, from, to, startedAt: new Date().toISOString(), finishedAt: null, results: [], blocked: null };
    void this.run(deviceId, from, to)
      .catch((e) => this.logger.error(`타일 수집 실패: ${e}`))
      .finally(() => {
        this.status.running = false;
        this.status.finishedAt = new Date().toISOString();
      });
    return this.status;
  }

  private async run(deviceId: string, from: number, to: number) {
    for (let n = from; n <= to; n++) {
      if (n > from) await sleep(TILE_GAP_MS);
      try {
        const data = await this.fetchTile(deviceId, n);
        const items = Array.isArray(data) ? data : [];
        await this.repo.save(this.repo.create({ tileNo: n, deviceId, fetchedAt: new Date(), status: 200, itemCount: items.length, raw: items }));
        this.status.results.push({ tile: n, status: 200, count: items.length });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.status.results.push({ tile: n, error: msg });
        if (e instanceof StopError) {
          this.status.blocked = msg;
          return; // 보안 확인·요청 제한이면 재시도 없이 중단
        }
      }
    }
  }

  private async fetchTile(deviceId: string, n: number): Promise<unknown> {
    const [a, b, lo, hi] = RAW_TILES[n];
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", SIGNING_KEY).update(`${ts}|GET|/develops|${BEHAVIOR}`).digest("hex") + "." + BEHAVIOR;
    const qs = `${tileBoxQuery(a, b, lo, hi)}&simplify=0.0001&include_completed=true`;
    const res = await fetch(`${API_BASE}/develops?${qs}`, {
      headers: {
        // 구 방식(jaegebal-zone-sync.service.ts apiGet)과 같은 최소 헤더(2026-11-08 사용자 요청). 브라우저 흉내 헤더(accept-language, priority, sec-*)는 보내지 않는다.
        accept: "application/json",
        referer: "https://jaegebal.com/",
        "user-agent": USER_AGENT,
        "x-jdc-app-token": APP_TOKEN,
        "x-jdc-device-id": deviceId,
        "x-jdc-timestamp": ts,
        "x-jdc-signature": sig,
      },
    });
    if ([403, 405, 429].includes(res.status)) throw new StopError(`HTTP ${res.status} (타일 ${n}) — 사이트가 막아 중단했습니다. 재시도하지 않습니다.`);
    if (!res.ok) throw new Error(`HTTP ${res.status} (타일 ${n})`);
    const body = (await res.json()) as { _enc?: string };
    return body && typeof body === "object" && body._enc ? decryptEnc(body._enc, deviceId) : body;
  }
}
