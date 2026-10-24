import { Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { execFile } from "child_process";
import { join } from "path";

/** samsam 프로젝트(C:\Users\user\OneDrive\vibecoding\samsam\backend\src\naver\naver-land.service.ts)의
 * 네이버 부동산(new.land.naver.com) 호출 구조를 그대로 이식했다 — samsam에서 Railway 미국 리전 + curl_cffi
 * 브릿지로 안정적으로 운영 중이라 같은 방식을 따른다(사용자 요청, 2026-10-24: "네이버 구조는 samsam을 그대로").
 *
 * 이식하지 않은 것: Prisma 저장(이 프로젝트는 TypeORM 엔티티에 저장), 브라우저(playwright) 헤더 캡처 폴백
 * (samsam도 프로덕션엔 브라우저를 안 깔아 이 폴백은 항상 실패한다).
 *
 * ⚠️ samsam CLAUDE.md "rate-limit 있는 외부 API" 규칙: 네이버는 IP가 막히면 복구에 몇 시간~하루가 걸린다.
 * 코드를 고칠 때마다 대량 작업을 처음부터 재실행하지 말고, 먼저 1~3건으로 확인하며, 가져온 원본은 저장해서
 * 재필터한다. 모든 호출은 직렬 큐 + 3.5~5.5초 랜덤 간격을 지난다. */

const CURL_BRIDGE_PATH = join(process.cwd(), "scripts", "naver_curl_bridge.py");

// 컨테이너(Nixpacks) 파이썬 가상환경 — start-with-crawler-v3.sh가 같은 파이썬으로 크롤러 워커를 띄운다
// (curl_cffi 설치됨, crawler/requirements-v3.txt). 로컬(Windows)은 `python`.
function pythonExecutable(): string {
  const fromEnv = process.env.PYTHON_PATH?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync("/opt/venv-v3/bin/python3")) return "/opt/venv-v3/bin/python3";
  return process.platform === "win32" ? "python" : "python3";
}

// Node의 기본 fetch(undici)는 TLS/HTTP2 핑거프린트가 실제 Chrome과 달라 유효한 Bearer 토큰/쿠키를 넣어도
// new.land.naver.com/api/* 첫 요청부터 429로 막힌다(samsam 실측 2026-09-12). 실제 네트워크 호출만 파이썬
// curl_cffi 브릿지(Chrome 핑거프린트 재현)로 위임한다.
function runCurlBridge(payload: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    // timeout 없이는 naver.com 쪽이 응답을 안 줄 때 프로세스가 무한정 매달린다(samsam 실측 5분+) — 30초로 끊는다.
    const child = execFile(
      pythonExecutable(),
      [CURL_BRIDGE_PATH],
      { maxBuffer: 10 * 1024 * 1024, env: { ...process.env }, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          const timedOut = (error as any).signal === "SIGTERM" || (error as any).killed;
          reject(new Error(timedOut ? "네이버 조회 시간 초과(30초)" : `curl_cffi 브릿지 실행 실패: ${stderr || error.message}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout.trim().split("\n").pop() || "{}"));
        } catch {
          reject(new Error(`curl_cffi 브릿지 출력 파싱 실패: ${stdout.slice(0, 500)}`));
        }
      },
    );
    child.stdin?.write(JSON.stringify(payload));
    child.stdin?.end();
  });
}

const SESSION_DIR = join(process.cwd(), ".session-cache");
const SESSION_PATH = join(SESSION_DIR, "naver-land.json");
const NEW_LAND = "https://new.land.naver.com";
// 토큰 워밍업에 쓸 아무 단지 (삼성보보스쉐르빌, samsam과 동일).
const WARMUP_COMPLEX_NO = "12647";

type CapturedHeaders = { authorization: string; cookie: string; savedAt: number };

// 수집 대상 매물 유형. samsam은 빌라+단독/다가구("VL:DDDGG")를 한 번에 받지만, 이 기능은 빌라(연립·다세대)만 쓴다
// (사용자 요청, 2026-10-24: "기본 수집 범위를 빌라만으로" — 단독/다가구는 건물 전체 가격이라 호수 단위 호가와 섞이면 오해).
// 네이버의 realEstateType은 콜론으로 구분한 코드 목록이라 "VL" 하나만 주면 빌라만 내려온다.
export const VILLA_REAL_ESTATE_TYPE = "VL";

// trade type codes used by /api/articles
export const TRADE_TYPES = { 매매: "A1", 전세: "B1", 월세: "B2" } as const;

// samsam: 요청 간격 3.5~5.5초 랜덤 지터(고정 간격은 규칙적인 장시간 패턴이 IP 평판에 나쁘게 작용했을 수 있다).
const REQUEST_GAP_MS_MIN = 3500;
const REQUEST_GAP_MS_MAX = 5500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// "1억 5,000" → 15000, "3억" → 30000, "5,000" → 5000 (만원 단위, 네이버 dealOrWarrantPrc 원본 표기 파싱)
export function parseKoreanManwon(s: unknown): number {
  const str = String(s ?? "").trim();
  if (!str) return 0;
  const eok = Number(str.match(/(\d+)\s*억/)?.[1] ?? 0) * 10000;
  const rest = Number(str.replace(/.*억/, "").replace(/[^\d]/g, "") || 0);
  return eok + rest;
}

// 매물 카드에 뜨는 "방한개"/"방두개"/"방세개"/"방네개이상" 같은 tagList 항목에서 방 개수를 뽑는다.
// "네개이상"은 그 이상 구분이 없어 4로 저장(=4개 이상이라는 뜻).
const ROOM_COUNT_WORDS: Record<string, number> = {
  한: 1,
  두: 2,
  세: 3,
  네: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
  열: 10,
};
export function parseRoomCountTag(tagList: unknown): number | null {
  if (!Array.isArray(tagList)) return null;
  for (const tag of tagList) {
    const m = String(tag ?? "").match(/^방(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열)개(이상)?$/);
    if (m) return ROOM_COUNT_WORDS[m[1]] ?? null;
  }
  return null;
}

// 목록 tagList엔 "15년이내"/"신축" 같은 연식 대략치 배지가 섞여 나올 때가 있다.
export function parseBuildingAgeTag(tagList: unknown): string | null {
  if (!Array.isArray(tagList)) return null;
  for (const tag of tagList) {
    const s = String(tag ?? "");
    if (s === "신축" || /^\d+년이내$/.test(s) || /^\d+년이상$/.test(s)) return s;
  }
  return null;
}

// 상세 응답의 administrationCostInfo → 관리비(만원) 또는 안내 문구(samsam 2026-10-14 실제 응답으로 확인한 구조).
export function parseAdministrationCost(aci: any): { manwon: number | null; memo: string | null } {
  if (!aci || typeof aci !== "object") return { manwon: null, memo: null };
  const toManwon = (won: number) => Math.round((won / 10000) * 10) / 10;
  const fixed = Array.isArray(aci.fixedFeeDetails) ? aci.fixedFeeDetails : [];
  if (fixed.length) {
    const sum = fixed.reduce((a: number, f: any) => a + (Number(f?.amount) || 0), 0);
    return sum > 0 ? { manwon: toManwon(sum), memo: null } : { manwon: null, memo: "금액 없음" };
  }
  const etc = aci.etcFeeDetails;
  if (etc && typeof etc === "object") {
    const amount = Number(etc.etcFeeAmount) || 0;
    if (amount > 0) return { manwon: toManwon(amount), memo: null };
    return { manwon: null, memo: etc.directInputContent ? String(etc.directInputContent) : "금액 없음" };
  }
  return { manwon: null, memo: null };
}

// 상세 응답 articleDetail → 입주가능일 문구.
export function parseMoveIn(d: any): string | null {
  if (!d || typeof d !== "object") return null;
  const name = d.moveInTypeName ? String(d.moveInTypeName) : null;
  if (name && name.includes("즉시")) return "즉시입주";
  const ymd = d.moveInPossibleYmd ? String(d.moveInPossibleYmd) : "";
  const m = ymd.match(/^(\d{4})(\d{2})(\d{2})$/);
  const discuss = d.moveInDiscussionPossibleYN === "Y" || d.moveInDiscussionPossibleYN === "협의가능";
  if (m) {
    const date = `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일`;
    return discuss ? `${date} 협의 가능` : date;
  }
  if (name) return discuss ? `${name} (협의 가능)` : name;
  return null;
}

/** 목록 API 매물 1건을 정리한 형태(원본은 raw로 따로 보관). */
export type NaverVillaArticle = {
  articleNo: string;
  name: string | null;
  typeName: string | null;
  tradeType: string | null;
  priceText: string | null;
  priceManwon: number | null;
  supplyAreaM2: number | null;
  exclusiveAreaM2: number | null;
  roomCount: number | null;
  ageTag: string | null;
  floorInfo: string | null;
  direction: string | null;
  confirmedAt: string | null;
  feature: string | null;
  realtor: string | null;
  lat: number | null;
  lng: number | null;
  raw: any;
};

export type NaverArticleDetail = {
  ok: boolean;
  address: string | null;
  realtorPhone: string | null;
  roomCount: number | null;
  buildingYear: number | null;
  useApprovalDate: string | null;
  photoUrls: string[];
  administrationCostManwon: number | null;
  administrationCostMemo: string | null;
  moveInText: string | null;
  lat: number | null;
  lng: number | null;
  featureDesc: string | null;
  introText: string | null;
  /** 정확한 전용/공급면적(목록 area1/area2는 정수로 반올림돼 있다). */
  exclusiveSpace: number | null;
  supplySpace: number | null;
  /** 필지고유번호 19자리 = 법정동코드(10) + 대지구분(1) + 본번(4) + 부번(4) — 지번/공시가 매칭의 가장 정확한 출처. */
  pnu: string | null;
  /** 현재 전세 보증금(만원) — articlePrice.allWarrantPrice. 매물 설명의 "갭 1.3억" 같은 값과 일치. */
  warrantPriceManwon: number | null;
  bathroomCount: number | null;
  householdCount: number | null;
  parkingCount: number | null;
  subwayWalkMin: number | null;
  lawUsage: string | null;
  heatMethod: string | null;
  raw: any;
};

@Injectable()
export class NaverLandService {
  private headers: CapturedHeaders | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  private async throttle() {
    const gap = REQUEST_GAP_MS_MIN + Math.random() * (REQUEST_GAP_MS_MAX - REQUEST_GAP_MS_MIN);
    const wait = gap - (Date.now() - this.lastRequestAt);
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private loadCached(): CapturedHeaders | null {
    try {
      if (this.headers) return this.headers;
      const raw = readFileSync(SESSION_PATH, "utf8");
      const parsed = JSON.parse(raw) as CapturedHeaders;
      // Naver's bearer JWT is valid for exactly 3h (samsam 검증: iat/exp diff = 10800s). 2.5시간 지난 건 다시 받는다.
      if (Date.now() - parsed.savedAt > 2.5 * 60 * 60 * 1000) return null;
      this.headers = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  private saveCached(h: CapturedHeaders) {
    this.headers = h;
    try {
      if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });
      writeFileSync(SESSION_PATH, JSON.stringify(h), "utf8");
    } catch {
      /* cache write is best-effort */
    }
  }

  // new.land.naver.com/complexes/{id} HTML 안에 그 SPA 세션용 bearer 토큰이 그대로 박혀 나온다
  // ( "token":{"token":"eyJ..."} ). 브라우저 없이 GET 한 번으로 토큰 + 쿠키를 확보한다.
  private async warmupHeaders(): Promise<CapturedHeaders | null> {
    try {
      const result = await runCurlBridge({ action: "warmup", complexNo: WARMUP_COMPLEX_NO });
      // 브릿지는 실패해도 예외를 던지지 않고 {ok:false, reason} 을 반환하므로 여기서 로그를 남긴다(samsam 2026-09-13).
      if (!result?.ok || !result.token) {
        console.error("네이버 부동산 토큰 워밍업 실패(ok=false):", JSON.stringify(result));
        return null;
      }
      const captured: CapturedHeaders = {
        authorization: `Bearer ${result.token}`,
        cookie: result.cookie ?? "",
        savedAt: Date.now(),
      };
      this.saveCached(captured);
      return captured;
    } catch (error) {
      console.error("네이버 부동산 토큰 워밍업 실패:", error instanceof Error ? error.message : error);
      return null;
    }
  }

  private async authHeaders(forceRefresh = false): Promise<CapturedHeaders | null> {
    if (!forceRefresh) {
      const cached = this.loadCached();
      if (cached) return cached;
    }
    return this.warmupHeaders();
  }

  private async apiGet<T>(path: string): Promise<T> {
    // serialize + space out every call
    const task = this.queue.then(() => this.apiGetInternal<T>(path));
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async apiGetInternal<T>(path: string): Promise<T> {
    await this.throttle();
    const doFetch = async (h: CapturedHeaders) => {
      const result = await runCurlBridge({
        action: "get",
        url: `${NEW_LAND}${path}`,
        headers: {
          authorization: h.authorization,
          cookie: h.cookie,
          referer: `${NEW_LAND}/`,
          accept: "application/json, text/plain, */*",
          "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        },
      });
      if (!result?.ok) throw new Error(result?.reason ?? "curl_cffi 브릿지 호출 실패");
      return { status: result.status as number, body: result.body as string };
    };

    let headers = await this.authHeaders();
    if (!headers) throw new Error("네이버 부동산 인증 헤더를 확보하지 못했습니다.");

    let res = await doFetch(headers);
    if (res.status === 401 || res.status === 403) {
      headers = await this.authHeaders(true);
      if (!headers) throw new Error("네이버 부동산 인증 재확보 실패.");
      res = await doFetch(headers);
    }
    if (res.status === 429) {
      await sleep(15000);
      res = await doFetch(headers);
    }
    if (res.status === 429) {
      throw new Error("네이버 부동산이 요청을 제한하고 있습니다 (429). 잠시 후 다시 시도하세요.");
    }
    if (res.status < 200 || res.status >= 300) throw new Error(`네이버 부동산 API ${path} → ${res.status}`);
    return JSON.parse(res.body) as T;
  }

  /** 좌표 → 동 코드(cortarNo). samsam complexesNearCoordinate()의 첫 호출과 동일(/api/cortars). */
  async cortarNoAt(lat: number, lng: number): Promise<string | null> {
    const cort = await this.apiGet<any>(`/api/cortars?zoom=17&centerLat=${lat}&centerLon=${lng}`);
    const no = cort?.cortarNo ?? cort?.cortarVO?.cortarNo ?? "";
    return no ? String(no) : null;
  }

  /** 동 단위 빌라 매물 목록 한 페이지(samsam fetchVillaArticlesRaw와 같은 파라미터: realEstateType=VL:DDDGG). */
  async fetchVillaArticlesPage(
    cortarNo: string,
    page: number,
    tradeType: keyof typeof TRADE_TYPES = "매매",
  ): Promise<{ raw: any[]; isMoreData: boolean; failed: boolean }> {
    const q = new URLSearchParams({
      cortarNo,
      realEstateType: VILLA_REAL_ESTATE_TYPE,
      tradeType: TRADE_TYPES[tradeType],
      priceType: "RETAIL",
      page: String(page),
      order: "rank",
    });
    // 요청이 실패하면 빈 목록으로 삼키지 않고 failed로 알려 호출한 쪽이 "조회 완료"로 치지 않게 한다(samsam 2026-09).
    let failed = false;
    const data = await this.apiGet<{ articleList?: any[]; isMoreData?: boolean }>(`/api/articles?${q.toString()}`).catch((e) => {
      console.error("네이버 매물 목록 조회 실패:", e instanceof Error ? e.message : e);
      failed = true;
      return null;
    });
    if (!failed && (data == null || !Array.isArray(data.articleList))) failed = true;
    return { raw: data?.articleList ?? [], isMoreData: !!data?.isMoreData, failed };
  }

  /** raw 네이버 매물 → 정리된 형태(samsam mapArticle과 같은 필드 해석). */
  mapArticle(a: any): NaverVillaArticle {
    const lat = Number(a.latitude) || null;
    const lng = Number(a.longitude) || null;
    const priceText = a.dealOrWarrantPrc ?? null;
    return {
      articleNo: String(a.articleNo ?? ""),
      name: a.articleName ?? a.buildingName ?? null,
      typeName: a.realEstateTypeName ?? null,
      tradeType: a.tradeTypeName ?? null,
      priceText,
      priceManwon: priceText ? parseKoreanManwon(priceText) || null : null,
      supplyAreaM2: Number(a.area1) || null,
      exclusiveAreaM2: Number(a.area2) || null,
      roomCount: parseRoomCountTag(a.tagList),
      ageTag: parseBuildingAgeTag(a.tagList),
      floorInfo: a.floorInfo ?? null,
      direction: a.direction ?? null,
      confirmedAt: a.articleConfirmYmd ?? null,
      feature: a.articleFeatureDesc ?? null,
      realtor: a.realtorName ?? null,
      lat,
      lng,
      raw: a,
    };
  }

  /** 매물 단건 상세(/api/articles/{no}) — samsam fetchArticleDetail과 같은 필드 추출 + 응답 원본(raw) 보존.
   * 목록 API의 tagList는 방 개수 배지가 밀려 안 나올 때가 많아 상세의 roomCount가 더 정확하다. */
  async fetchArticleDetail(articleNo: string): Promise<NaverArticleDetail> {
    const empty: NaverArticleDetail = {
      ok: false,
      address: null,
      realtorPhone: null,
      roomCount: null,
      buildingYear: null,
      useApprovalDate: null,
      photoUrls: [],
      administrationCostManwon: null,
      administrationCostMemo: null,
      moveInText: null,
      lat: null,
      lng: null,
      featureDesc: null,
      introText: null,
      exclusiveSpace: null,
      supplySpace: null,
      pnu: null,
      warrantPriceManwon: null,
      bathroomCount: null,
      householdCount: null,
      parkingCount: null,
      subwayWalkMin: null,
      lawUsage: null,
      heatMethod: null,
      raw: null,
    };
    try {
      const data = await this.apiGet<any>(`/api/articles/${articleNo}`);
      const d = data?.articleDetail;
      const { manwon: administrationCostManwon, memo: administrationCostMemo } = parseAdministrationCost(
        data?.administrationCostInfo ?? null,
      );
      const cleanText = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 3000) : null);
      const featureDesc = cleanText(d?.articleFeatureDescription ?? d?.articleFeatureDesc ?? d?.featureDescription);
      const introText = cleanText(d?.detailDescription ?? d?.articleDescription ?? d?.description);
      // 좌표: 목록 API가 좌표를 안 준 매물용. 알려진 이름(latitude/longitude 등)을 응답 여러 객체에서 찾는다.
      const numIn = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) && n !== 0 ? n : null;
      };
      const pickPair = (o: any): [number | null, number | null] =>
        o ? [numIn(o.latitude ?? o.lat), numIn(o.longitude ?? o.lng ?? o.lon)] : [null, null];
      let lat: number | null = null;
      let lng: number | null = null;
      for (const o of [d, data?.articleAddition, data?.articleSpace, data?.articleFacility, data]) {
        const [a, b] = pickPair(o);
        if (a != null && b != null && a > 33 && a < 39 && b > 124 && b < 132) {
          lat = a;
          lng = b;
          break;
        }
      }
      const photos = Array.isArray(data?.articlePhotos) ? data.articlePhotos : [];
      const photoUrls = photos
        .map((p: any) => (p?.imageSrc ? `https://landthumb-phinf.pstatic.net${p.imageSrc}` : null))
        .filter((u: string | null): u is string => !!u);
      const address = d?.exposureAddress || [d?.cityName, d?.divisionName, d?.sectionName].filter(Boolean).join(" ") || null;
      const r = data?.articleRealtor;
      // 휴대폰(cellPhoneNo)을 우선하고, 없으면 대표번호(대개 사무실 유선)로 폴백.
      const realtorPhone = r?.cellPhoneNo || r?.representativeTelNo || null;
      const roomCount = d?.roomCount != null ? Number(d.roomCount) || null : null;
      // 실측(2026-10-24): 사용승인일은 articleDetail이 아니라 articleFacility.buildingUseAprvYmd("20160705")에 있다.
      // 준공연도는 따로 없어 사용승인일 앞 4자리로 구한다. 이전 후보 이름들도 함께 본다.
      const approvalValue =
        data?.articleFacility?.buildingUseAprvYmd ?? d?.buildingUseAprvYmd ?? d?.useApproveYmd ?? d?.buildingUseApprovalDate ?? null;
      const useApprovalDate = approvalValue != null && String(approvalValue).trim() ? String(approvalValue).trim() : null;
      const yearValue = d?.buildYear ?? d?.buildingBuildYear ?? d?.buildingYear ?? useApprovalDate?.slice(0, 4) ?? null;
      const buildingYear = yearValue != null && /^\d{4}$/.test(String(yearValue)) ? Number(yearValue) : null;
      const posNum = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      return {
        ok: true,
        address,
        realtorPhone,
        roomCount,
        buildingYear,
        useApprovalDate,
        photoUrls,
        administrationCostManwon,
        administrationCostMemo,
        moveInText: parseMoveIn(d),
        lat,
        lng,
        featureDesc,
        introText,
        exclusiveSpace: posNum(data?.articleSpace?.exclusiveSpace),
        supplySpace: posNum(data?.articleSpace?.supplySpace),
        pnu: typeof d?.pnu === "string" && /^\d{19}$/.test(d.pnu) ? d.pnu : null,
        warrantPriceManwon: posNum(data?.articlePrice?.allWarrantPrice),
        bathroomCount: posNum(d?.bathroomCount),
        householdCount: posNum(d?.householdCount),
        parkingCount: posNum(d?.parkingCount),
        subwayWalkMin: posNum(d?.walkingTimeToNearSubway),
        lawUsage: cleanText(d?.lawUsage),
        heatMethod: cleanText(data?.articleFacility?.heatMethodTypeName),
        raw: data,
      };
    } catch (e) {
      // 원인을 로그로 남겨야 인증 만료/차단/매물 삭제 중 무엇인지 구분할 수 있다(samsam).
      console.warn(`[NaverLandService] fetchArticleDetail(${articleNo}) 실패: ${e instanceof Error ? e.message : String(e)}`);
      return empty;
    }
  }
}
