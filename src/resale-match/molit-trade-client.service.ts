import { Injectable, Logger } from "@nestjs/common";

const ENDPOINT =
  "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

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
    const url = new URL(ENDPOINT);
    url.searchParams.set("serviceKey", this.apiKey);
    url.searchParams.set("LAWD_CD", lawdCd);
    url.searchParams.set("DEAL_YMD", dealYm);
    url.searchParams.set("numOfRows", "1000");
    url.searchParams.set("pageNo", "1");

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) {
      throw new Error(
        `국토부 실거래가 API 호출 실패: ${res.status} ${res.statusText} (LAWD_CD=${lawdCd}, DEAL_YMD=${dealYm})`,
      );
    }
    const xml = await res.text();
    return this.parseItems(xml);
  }

  /** 이 API 응답은 항상 `<item><태그>값</태그>...</item>` 형태의 평탄한
   * XML이라(중첩 요소·속성 없음, 실측 확인) 별도 XML 파서 의존성 없이
   * 정규식으로 안전하게 파싱한다. */
  private parseItems(xml: string): MolitTradeItem[] {
    const resultCode = xml.match(/<resultCode>(\d+)<\/resultCode>/)?.[1];
    if (resultCode && resultCode !== "000") {
      const resultMsg = xml.match(/<resultMsg>([^<]*)<\/resultMsg>/)?.[1] ?? "";
      this.logger.warn(`국토부 API 비정상 응답(resultCode=${resultCode}): ${resultMsg}`);
      return [];
    }

    const items: MolitTradeItem[] = [];
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) ?? [];
    for (const block of itemBlocks) {
      const fields: Record<string, string> = {};
      const fieldMatches = block.matchAll(/<([a-zA-Z]+)>([^<]*)<\/\1>/g);
      for (const m of fieldMatches) {
        fields[m[1]] = this.decodeXmlEntities(m[2]).trim();
      }
      items.push(fields as unknown as MolitTradeItem);
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
