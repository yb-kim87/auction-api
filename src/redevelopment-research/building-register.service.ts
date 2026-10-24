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
    const key = process.env.BUILDING_REGISTER_API_KEY?.trim();
    if (!key) {
      this.logger.warn("BUILDING_REGISTER_API_KEY가 없어 건축물대장 조회를 건너뜁니다.");
      return null;
    }
    const [bun, ji = "0"] = jibun.split("-");
    if (legalDongCode.length < 10 || !/^\d+$/.test(bun) || !/^\d+$/.test(ji)) return 0;
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
      return Math.round(plat * 100) / 100;
    } catch (e) {
      this.logger.warn(`건축물대장 표제부 조회 실패(${legalDongCode} ${jibun}): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
