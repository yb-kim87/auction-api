import { Injectable, Logger } from "@nestjs/common";

const BR_TITLE = "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo";
const TIMEOUT_MS = 15_000;

/** 건축물대장 표제부(getBrTitleInfo)에서 건물 대지면적(platArea)을 가져온다 — 호별 대지지분 추정(대지면적 × 전용면적 비례)에 쓴다.
 * 국토부 실거래·부가세 계산기와 같은 data.go.kr 키(BUILDING_REGISTER_API_KEY)를 쓰므로 호출 한도를 공유한다.
 * 실측(2026-10-25, 대림동 6곳): 대지면적 × (전용 ÷ 건물 전용합)이 실거래 대지권면적(landAr)과 0~1%(3곳) / +11%(2곳)로 일치하고,
 * 연립 여러 동 단지는 표제부 대지면적이 0이라 계산 불가. */
@Injectable()
export class BuildingRegisterService {
  private readonly logger = new Logger(BuildingRegisterService.name);

  /** 법정동코드(10) + 지번("684-7") → 대지면적(㎡). 조회는 성공했지만 데이터가 없으면 0, 호출 실패는 null. */
  async fetchPlatArea(legalDongCode: string, jibun: string): Promise<number | null> {
    const info = await this.fetchTitleInfo(legalDongCode, jibun);
    return info ? info.plat : null;
  }

  /** 건축물대장 전유부(getBrExposPubuseAreaInfo)에서 이 지번 전체의 "전유" 호 전용면적 합계와 호 수를 구한다 — 대지지분 추정의 분모.
   * 공시가격 DB 호 목록은 호가 빠지거나 다른 동이 섞여 합계가 어긋나는 경우가 있어(실측 2026-10-26: 실거래 대지권 15건 비교 시
   * 오차 중앙값 8.3% → 0.1%) 대장 전유부 합계를 우선한다. 호출 실패는 null. */
  async fetchExposedAreaSum(legalDongCode: string, jibun: string): Promise<{ sum: number; count: number } | null> {
    const key = process.env.BUILDING_REGISTER_API_KEY?.trim();
    if (!key) return null;
    const [bun, ji = "0"] = jibun.split("-");
    if (legalDongCode.length < 10 || !/^\d+$/.test(bun) || !/^\d+$/.test(ji)) return { sum: 0, count: 0 };
    const url = new URL("https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo");
    url.searchParams.set("sigunguCd", legalDongCode.slice(0, 5));
    url.searchParams.set("bjdongCd", legalDongCode.slice(5, 10));
    url.searchParams.set("platGbCd", "0");
    url.searchParams.set("bun", bun.padStart(4, "0"));
    url.searchParams.set("ji", ji.padStart(4, "0"));
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("numOfRows", "500");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`건축물대장 전유부 조회 실패(${legalDongCode} ${jibun}): HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { response?: { body?: { items?: { item?: unknown } | "" } } };
      const items = data.response?.body?.items;
      const raw = items && typeof items === "object" ? items.item : null;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
      const own = list.filter((i) => i.exposPubuseGbCdNm === "전유");
      const sum = own.reduce((a, i) => a + (Number(i.area) || 0), 0);
      return { sum: Math.round(sum * 100) / 100, count: own.length };
    } catch (e) {
      this.logger.warn(`건축물대장 전유부 조회 실패(${legalDongCode} ${jibun}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 표제부 한 번 호출로 대지면적과 사용승인일(연도)을 함께 얻는다(같은 호출이라 한도를 더 쓰지 않는다).
   * 데이터가 없으면 plat 0·year null, 호출 실패는 null. */
  async fetchTitleInfo(legalDongCode: string, jibun: string): Promise<{ plat: number; year: number | null; useApprovalDate: string | null } | null> {
    const key = process.env.BUILDING_REGISTER_API_KEY?.trim();
    if (!key) {
      this.logger.warn("BUILDING_REGISTER_API_KEY가 없어 건축물대장 조회를 건너뜁니다.");
      return null;
    }
    const [bun, ji = "0"] = jibun.split("-");
    if (legalDongCode.length < 10 || !/^\d+$/.test(bun) || !/^\d+$/.test(ji)) return { plat: 0, year: null, useApprovalDate: null };
    const url = new URL(BR_TITLE);
    url.searchParams.set("sigunguCd", legalDongCode.slice(0, 5));
    url.searchParams.set("bjdongCd", legalDongCode.slice(5, 10));
    url.searchParams.set("platGbCd", "0");
    url.searchParams.set("bun", bun.padStart(4, "0"));
    url.searchParams.set("ji", ji.padStart(4, "0"));
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`건축물대장 표제부 조회 실패(${legalDongCode} ${jibun}): HTTP ${res.status}`);
        return null;
      }
      const data = (await res.json()) as { response?: { body?: { items?: { item?: unknown } | "" } } };
      const items = data.response?.body?.items;
      const raw = items && typeof items === "object" ? items.item : null;
      const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Array<Record<string, unknown>>;
      // 표제부가 여러 건이면(동별) 대지면적이 가장 큰 값 — 연립 여러 동은 0으로 오는 경우가 많다.
      const plat = Math.max(0, ...list.map((i) => Number(i.platArea) || 0));
      // 사용승인일(YYYYMMDD) — 대지면적이 가장 큰 동의 값을 우선하고, 없으면 값이 있는 아무 동.
      const byPlat = [...list].sort((a, b) => (Number(b.platArea) || 0) - (Number(a.platArea) || 0));
      const useApr = byPlat.map((i) => String(i.useAprDay ?? "").trim()).find((v) => /^\d{8}$/.test(v)) ?? null;
      return { plat: Math.round(plat * 100) / 100, year: useApr ? Number(useApr.slice(0, 4)) : null, useApprovalDate: useApr };
    } catch (e) {
      this.logger.warn(`건축물대장 표제부 조회 실패(${legalDongCode} ${jibun}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
