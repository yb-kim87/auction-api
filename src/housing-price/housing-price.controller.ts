import {
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { HousingPriceService, type HousingOfficialPriceRow } from "./housing-price.service";

/** 부동산플래닛(bdsplanet.com)이 호별 공시가격을 보여주는 방식을 실측
 * 분석해(2026-10-24, 네트워크 요청 역추적) 재현한 것 — 저쪽도 주소/PNU로
 * 건축물대장PK(mgmBldrgstPk)를 먼저 얻은 뒤, 그 PK로 공시가격을
 * 매칭한다. 우리도 이미 vat.controller.ts의 "건축물대장(전유부)" 조회에
 * 같은 BldRgstHubService/getBrExposPubuseAreaInfo API로 PK를 뽑는 로직이
 * 있었다(2026-08-06) — 여기서는 그 PK 조회만 가볍게 재사용해 공시가격
 * 조회와 바로 이어붙인다(사용자 요청: "적용해보자"). */

/** hoNm에서 "호" 단위 숫자만 뽑는다 — "301", "301호", "2층 301호",
 * "2층302호"처럼 표기가 제각각이라(실측: 대림동 686-9번지, 2026-10-24)
 * 비교 전에 숫자만 남겨 정규화한다. */
function normalizeHoDigits(s: string): string {
  const match = s.match(/(\d+)\s*호?\s*$/);
  return match ? match[1] : s.replace(/\s/g, "");
}

/** PNU+동/호로 관리건축물대장PK를 찾는다.
 *
 * 처음엔 API의 hoNm 쿼리 파라미터로 서버 필터링을 시도했으나(실측,
 * 2026-10-24), "2층 301호"처럼 층수가 호명에 섞인 다세대 건물에서는
 * "301", "2층 301", "2층301호" 등 어떤 조합으로 보내도 0건이 나왔다 —
 * API가 hoNm을 완전일치로만 비교하는데 등록된 표기 자체가 건물마다
 * 제각각이라 추측이 불가능하다. 그래서 hoNm 필터 없이 그 필지의 모든
 * 호실을 받아온 뒤, 숫자만 정규화해 클라이언트에서 직접 매칭한다. */
async function resolveHousingLedgerPk(
  logger: Logger,
  key: string,
  params: { sigunguCd: string; bjdongCd: string; bun: string; ji: string },
  dong: string,
  ho: string,
): Promise<string | null> {
  const targetDigits = normalizeHoDigits(ho.trim());
  // 동이 있는 아파트 단지는 같은 호수(예: 301호)가 여러 동에 겹칠 수
  // 있어 동 이름도 함께 비교한다. 다세대/연립처럼 동이 없는 건물은
  // dongNm이 공백(" ")으로 오므로 dong이 비어있으면 동 비교를 생략한다.
  const targetDong = dong.trim();

  const fetchOnce = async (platGbCd: "0" | "1") => {
    const url = new URL(
      "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo",
    );
    url.searchParams.set("sigunguCd", params.sigunguCd);
    url.searchParams.set("bjdongCd", params.bjdongCd);
    url.searchParams.set("platGbCd", platGbCd);
    url.searchParams.set("bun", params.bun);
    url.searchParams.set("ji", params.ji);
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("numOfRows", "100");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return [];
      const data = (await res.json()) as {
        response?: {
          header?: { resultCode?: string };
          body?: { items?: { item?: Record<string, unknown>[] } | "" };
        };
      };
      if (data.response?.header?.resultCode !== "00") return [];
      const items = data.response?.body?.items;
      return items && typeof items === "object" && Array.isArray(items.item)
        ? items.item
        : [];
    } catch (err) {
      logger.error(`건축물대장(전유부) 조회 실패: ${err instanceof Error ? err.message : err}`);
      return [];
    }
  };

  const [rows0, rows1] = await Promise.all([fetchOnce("0"), fetchOnce("1")]);
  const rows = [...rows0, ...rows1];
  const hoMatches = rows.filter((r) => {
    const hoNm = typeof r.hoNm === "string" ? r.hoNm : "";
    return normalizeHoDigits(hoNm) === targetDigits;
  });
  const match = targetDong
    ? (hoMatches.find((r) => {
        const dongNm = typeof r.dongNm === "string" ? r.dongNm.trim() : "";
        return dongNm === targetDong || dongNm === `${targetDong}동`;
      }) ?? hoMatches[0])
    : hoMatches[0];
  if (!match) return null;
  return match.mgmBldrgstPk != null && match.mgmBldrgstPk !== ""
    ? String(match.mgmBldrgstPk)
    : null;
}

/** 국토부_주택 공시가격 정보(data.go.kr 3073746) 연 1회 CSV 배치를
 * 적재/조회하는 관리자 전용 API. 실시간 API가 아니라 파일 배치라
 * `crawler/import_housing_official_price.py`가 로컬에서 CSV를 파싱해
 * 청크 단위로 이 엔드포인트를 호출한다(사용자 요청, 2026-08-06). */
@Controller("housing-price")
export class HousingPriceController {
  private readonly logger = new Logger(HousingPriceController.name);

  constructor(private readonly service: HousingPriceService) {}

  /** CSV 배치 임포트 — 연 1회, 사람이 로컬에서 스크립트를 돌리는
   * 상황이라 로그인 세션이 아니라 크롤러와 같은 시크릿 헤더로 인증한다
   * (crawler.controller.ts의 x-crawler-secret 패턴과 동일). */
  @Post("import")
  async import(
    @Headers() headers: Record<string, string>,
    @Body() body: { rows: HousingOfficialPriceRow[] },
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }
    return this.service.bulkUpsert(body.rows ?? []);
  }

  @Get("lookup")
  async lookup(
    @Headers() headers: Record<string, string>,
    @Query("housingLedgerPk") housingLedgerPk: string,
    @Query("hoNm") hoNm: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.findLatestByLedgerPk(housingLedgerPk, hoNm);
  }

  /** PNU + 동/호만으로 공시가격을 바로 조회한다 — 부동산플래닛 실측
   * 분석(2026-10-24)으로 확인한 "PNU→건축물대장PK→공시가격 매칭" 흐름을
   * 그대로 재현해, 관리자가 housingLedgerPk를 따로 몰라도 되게 한다.
   * CSV가 아직 임포트되지 않은 지역/연도는 housingPrice가 null로 온다
   * (PK 조회 자체는 실시간이지만, 공시가격 값은 국토부가 CSV 배치로만
   * 배포해 우리 DB에 미리 적재해둔 범위에서만 나온다 — 2026-10-24
   * 조사로 재확인, data.go.kr에 공동주택가격 실시간 API는 없음). */
  @Get("lookup-by-pnu")
  async lookupByPnu(
    @Headers() headers: Record<string, string>,
    @Query("pnu") pnu: string,
    @Query("dong") dong: string | undefined,
    @Query("ho") ho: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!pnu || pnu.trim().length !== 19) {
      throw new ServiceUnavailableException("올바른 PNU(19자리)가 필요합니다.");
    }
    if (!ho?.trim()) {
      throw new ServiceUnavailableException("호가 필요합니다.");
    }
    const key = process.env.BUILDING_REGISTER_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException("건축물대장 API 키가 설정되지 않았습니다.");
    }

    const trimmed = pnu.trim();
    const housingLedgerPk = await resolveHousingLedgerPk(
      this.logger,
      key,
      {
        sigunguCd: trimmed.slice(0, 5),
        bjdongCd: trimmed.slice(5, 10),
        bun: trimmed.slice(11, 15),
        ji: trimmed.slice(15, 19),
      },
      dong?.trim() ?? "",
      ho.trim(),
    );
    if (!housingLedgerPk) {
      throw new ServiceUnavailableException(
        "이 동/호의 건축물대장PK를 찾지 못했습니다.",
      );
    }

    const hoNm = ho.trim().replace(/호\s*$/, "").trim();
    const housingPrice = await this.service.findLatestByLedgerPk(housingLedgerPk, hoNm);
    return { housingLedgerPk, housingPrice };
  }
}
