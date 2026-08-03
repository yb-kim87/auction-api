import { Injectable, Logger } from "@nestjs/common";

const APT_ENDPOINT =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

/** 연립다세대매매 실거래자료(빌라: 연립주택/다세대/도시형생활주택).
 * 아파트매매와는 data.go.kr 별개 상품이라 개별 활용신청/승인이 필요했다
 * (2026-08-01 조사 시점엔 403, 2026-08-03 재확인 시 승인 완료). */
const RH_ENDPOINT =
  "https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade";

/** data.go.kr이 응답 없이 연결을 물고 있는 경우(실측: 288개 조합 순회
 * 중 하나에서 무한 대기, 2026-07-28) 배치 전체가 멈추지 않도록 개별
 * 호출에 타임아웃을 둔다. */
const FETCH_TIMEOUT_MS = 20_000;

/** 국토교통부 공식 실거래가 API(RTMSDataSvcAptTrade) 응답 1건.
 * 실측 확인된 필드만 옮긴다(2026-07-28,
 * docs/auction-resale-matching-data-findings.md 8~9장). */
export type MolitTradeItem = {
  aptDong: string;
  aptNm: string;
  buildYear: string;
  buyerGbn: string;
  cdealDay: string;
  cdealType: string;
  dealAmount: string;
  dealDay: string;
  dealMonth: string;
  dealYear: string;
  dealingGbn: string;
  excluUseAr: string;
  floor: string;
  jibun: string;
  landLeaseholdGbn: string;
  rgstDate: string;
  sggCd: string;
  slerGbn: string;
  umdNm: string;
  /** 아파트 API엔 없는 필드(빌라 전용) — 대지면적. 빌라는 실거래에 "동"
   * 정보가 없어 대신 이 값으로 동 일치 확증 신호를 보조한다(2026-08-03,
   * 사용자 요청 — 단, 비중은 작게). */
  landAr?: string;
};

/** 연립다세대매매(RTMSDataSvcRHTrade) 응답 1건 원본 필드(실측,
 * 2026-08-03). 아파트 응답과 달리 단지명은 mhouseNm, 전용면적은
 * excluUseAr로 동일하지만 aptDong/landLeaseholdGbn이 없고 houseType/
 * landAr/estateAgentSggNm이 추가로 온다. */
type MolitVillaTradeItemRaw = {
  buildYear: string;
  buyerGbn: string;
  cdealDay: string;
  cdealType: string;
  dealAmount: string;
  dealDay: string;
  dealMonth: string;
  dealYear: string;
  dealingGbn: string;
  estateAgentSggNm: string;
  excluUseAr: string;
  floor: string;
  houseType: string;
  jibun: string;
  landAr: string;
  mhouseNm: string;
  rgstDate: string;
  sggCd: string;
  slerGbn: string;
  umdNm: string;
};

/** BUILDING_REGISTER_API_KEY(부가세계산기용으로 이미 등록된 data.go.kr
 * 계정 키)를 그대로 재사용한다 — "아파트매매 실거래가 자료" API 상품만
 * 추가 활용신청하면 신규 키 발급 없이 그대로 호출 가능함을 실측
 * 확인했다. */
@Injectable()
export class MolitTradeClientService {
  private readonly logger = new Logger(MolitTradeClientService.name);

  private get apiKey(): string {
    const key = process.env.BUILDING_REGISTER_API_KEY?.trim();
    if (!key) {
      throw new Error(
        "BUILDING_REGISTER_API_KEY 환경변수가 설정되어 있지 않습니다(국토부 실거래가 API 재사용 키).",
      );
    }
    return key;
  }

  /** LAWD_CD(법정동코드 5자리) + DEAL_YMD(계약년월, "YYYYMM") 단위로
   * 조회한다 — 이 API는 단지 단위 필터가 없으므로, 시군구 전체 응답을
   * 그대로 반환한다(호출한 쪽에서 umdNm+jibun으로 후처리 필터링). */
  async fetchTrades(lawdCd: string, dealYm: string): Promise<MolitTradeItem[]> {
    const xml = await this.fetchXml(APT_ENDPOINT, lawdCd, dealYm, "아파트");
    return this.parseItems<MolitTradeItem>(xml);
  }

  /** 연립다세대(빌라: 연립주택/다세대/도시형생활주택) 실거래 조회. 응답의
   * 단지명 필드(mhouseNm)를 기존 파이프라인이 기대하는 aptNm으로,
   * aptDong/landLeaseholdGbn은 이 API에 없으므로 빈 문자열로 맞춰
   * `MolitTradeItem` 형태로 정규화해 반환한다 — 호출부(TradeIngestionService)
   * 가 아파트/빌라를 구분하지 않고 동일하게 처리할 수 있게 하기 위함. */
  async fetchVillaTrades(lawdCd: string, dealYm: string): Promise<MolitTradeItem[]> {
    const xml = await this.fetchXml(RH_ENDPOINT, lawdCd, dealYm, "빌라(연립다세대)");
    const raw = this.parseItems<MolitVillaTradeItemRaw>(xml);
    return raw.map((item) => ({
      aptDong: "",
      aptNm: item.mhouseNm,
      buildYear: item.buildYear,
      buyerGbn: item.buyerGbn,
      cdealDay: item.cdealDay,
      cdealType: item.cdealType,
      dealAmount: item.dealAmount,
      dealDay: item.dealDay,
      dealMonth: item.dealMonth,
      dealYear: item.dealYear,
      dealingGbn: item.dealingGbn,
      excluUseAr: item.excluUseAr,
      floor: item.floor,
      jibun: item.jibun,
      landLeaseholdGbn: "",
      rgstDate: item.rgstDate,
      sggCd: item.sggCd,
      slerGbn: item.slerGbn,
      umdNm: item.umdNm,
      landAr: item.landAr,
    }));
  }

  private async fetchXml(
    endpoint: string,
    lawdCd: string,
    dealYm: string,
    label: string,
  ): Promise<string> {
    const url = new URL(endpoint);
    url.searchParams.set("serviceKey", this.apiKey);
    url.searchParams.set("LAWD_CD", lawdCd);
    url.searchParams.set("DEAL_YMD", dealYm);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(
          `국토부 ${label} 실거래가 API 호출 타임아웃(${FETCH_TIMEOUT_MS / 1000}초, LAWD_CD=${lawdCd}, DEAL_YMD=${dealYm})`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    if (!res.ok) {
      throw new Error(
        `국토부 ${label} 실거래가 API 호출 실패: ${res.status} ${res.statusText} (LAWD_CD=${lawdCd}, DEAL_YMD=${dealYm})`,
      );
    }
    return res.text();
  }

  /** 이 API 응답은 항상 `<item><태그>값</태그>...</item>` 형태의 평탄한
   * XML이라(중첩 요소·속성 없음, 실측 확인) 별도 XML 파서 의존성 없이
   * 정규식으로 안전하게 파싱한다. */
  private parseItems<T>(xml: string): T[] {
    const resultCode = xml.match(/<resultCode>(\d+)<\/resultCode>/)?.[1];
    if (resultCode && resultCode !== "000") {
      const resultMsg = xml.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1] ?? "";
      this.logger.warn(`국토부 API 비정상 응답(resultCode=${resultCode}): ${resultMsg}`);
      return [];
    }

    const items: T[] = [];
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const block of itemBlocks) {
      const fields: Record<string, string> = {};
      const fieldMatches = block.matchAll(/<([a-zA-Z]+)>([^<]*)<\/\1>/g);
      for (const m of fieldMatches) {
        fields[m[1]] = this.decodeXmlEntities(m[2]).trim();
      }
      items.push(fields as unknown as T);
    }
    return items;
  }

  private decodeXmlEntities(text: string): string {
    return text
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }
}
