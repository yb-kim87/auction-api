import {
  Controller,
  Get,
  Headers,
  Logger,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";

/** fetch 실패(TypeError, 예: undici 레벨 연결 오류)는 기본적으로 원인
 * (cause: ECONNREFUSED, DNS 실패, TLS 오류 등)이 로그에 안 찍혀 원인
 * 파악이 어렵다(실측: Railway에서 VWorld 호출이 "fetch failed"로만
 * 남고 원인 불명, 2026-07-21) — cause까지 로그에 남기고, 사용자에게도
 * 외부 API 연결 실패임을 명확히 알린다. */
async function fetchExternal(
  logger: Logger,
  label: string,
  url: string,
): Promise<Response> {
  try {
    return await fetch(url);
  } catch (err) {
    const cause =
      err instanceof Error
        ? ((err as { cause?: unknown }).cause ?? err.message)
        : err;
    logger.error(`${label} 호출 실패: ${JSON.stringify(cause)}`);
    throw new ServiceUnavailableException(
      `${label} 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
    );
  }
}

/** 부가세 계산기(admin CrawlerVatTab)의 "주소 검색 → 토지공시지가 자동조회"
 * 기능이 VWorld(국토교통부 공간정보 오픈플랫폼) API를 호출한다. API 키를
 * 프론트에 그대로 노출하지 않기 위해 백엔드에서 대신 호출하는 프록시.
 * atomtax-app.vercel.app을 실측 분석해 확인한 것과 동일한 API
 * (api.vworld.kr/req/address, req/data)를 사용한다(2026-07-21). */
@Controller("vat")
export class VatController {
  private readonly logger = new Logger(VatController.name);

  private get apiKey(): string {
    const key = process.env.VWORLD_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        "VWorld API 키가 설정되지 않았습니다.",
      );
    }
    return key;
  }

  /** 도로명주소 → 좌표 → PNU 조회(2단계).
   *
   * 카카오 우편번호 팝업이 주는 값은 도로명주소("인천 남동구 구월로 65")
   * 인데, VWorld getCoord를 type=PARCEL(지번)로 호출하면 도로명주소를
   * 못 찾아 NOT_FOUND가 난다(실측: "구월로 65"가 PARCEL로는 0건,
   * ROAD로는 정상 매칭, 2026-07-21) — 그래서 반드시 type=ROAD로 먼저
   * 좌표를 구해야 한다. 그런데 ROAD 응답에는 PNU(structure.level4LC)가
   * 비어 있다(도로명·지번은 별개 체계라 ROAD 검색 결과에 지번 코드가
   * 안 실림) — 얻은 좌표를 다시 getAddress(역지오코딩, type=PARCEL)로
   * 조회해야 법정동코드+본번+부번을 얻어 PNU를 조합할 수 있다.
   */
  @Get("address-to-coord")
  async addressToCoord(
    @Headers() headers: Record<string, string>,
    @Query("address") address: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!address?.trim()) {
      throw new ServiceUnavailableException("주소가 필요합니다.");
    }
    const trimmed = address.trim();

    const coordUrl = new URL("https://api.vworld.kr/req/address");
    coordUrl.searchParams.set("service", "address");
    coordUrl.searchParams.set("request", "getCoord");
    coordUrl.searchParams.set("version", "2.0");
    coordUrl.searchParams.set("crs", "EPSG:4326");
    coordUrl.searchParams.set("type", "ROAD");
    coordUrl.searchParams.set("address", trimmed);
    coordUrl.searchParams.set("format", "json");
    coordUrl.searchParams.set("key", this.apiKey);

    const coordRes = await fetchExternal(
      this.logger,
      "VWorld 주소 변환",
      coordUrl.toString(),
    );
    if (!coordRes.ok) {
      throw new ServiceUnavailableException("VWorld 주소 변환 요청 실패");
    }
    const coordData = (await coordRes.json()) as {
      response?: {
        status?: string;
        result?: { point?: { x?: string; y?: string } };
        refined?: { text?: string };
      };
    };
    const point = coordData.response?.result?.point;
    if (coordData.response?.status !== "OK" || !point?.x || !point?.y) {
      return coordData;
    }

    const reverseUrl = new URL("https://api.vworld.kr/req/address");
    reverseUrl.searchParams.set("service", "address");
    reverseUrl.searchParams.set("request", "getAddress");
    reverseUrl.searchParams.set("version", "2.0");
    reverseUrl.searchParams.set("crs", "EPSG:4326");
    reverseUrl.searchParams.set("point", `${point.x},${point.y}`);
    reverseUrl.searchParams.set("type", "PARCEL");
    reverseUrl.searchParams.set("format", "json");
    reverseUrl.searchParams.set("key", this.apiKey);

    const reverseRes = await fetchExternal(
      this.logger,
      "VWorld 역지오코딩",
      reverseUrl.toString(),
    );
    let pnu: string | null = null;
    if (reverseRes.ok) {
      const reverseData = (await reverseRes.json()) as {
        response?: {
          status?: string;
          result?: {
            structure?: { level4LC?: string; level5?: string };
          }[];
        };
      };
      const structure = reverseData.response?.result?.[0]?.structure;
      const dongCode = structure?.level4LC?.trim();
      // level5는 "900-153"(본번-부번) 또는 "736"(부번 없음) 형태.
      const [bunRaw, jiRaw] = (structure?.level5 ?? "").split("-");
      if (dongCode && bunRaw) {
        const bun = bunRaw.padStart(4, "0").slice(-4);
        const ji = (jiRaw ?? "0").padStart(4, "0").slice(-4);
        // PNU 11번째 자리(산여부)는 이 API 응답만으로 확정할 수 없어
        // 일반 대지(0)로 고정한다 — 건축물대장 조회 쪽에서 0/1 모두
        // 재시도하므로 실제 조회 정확도에는 영향이 없다.
        pnu = `${dongCode}1${bun}${ji}`;
      }
    }

    return {
      ...coordData,
      response: {
        ...coordData.response,
        refined: {
          ...coordData.response?.refined,
          structure: { level4LC: pnu ?? "" },
        },
      },
    };
  }

  /** 좌표(경도/위도) 기준 개별공시지가 조회(원/㎡). VWorld data API의
   * LP_PA_CBND_BUBUN(개별공시지가) 레이어를 사용한다.
   *
   * VWorld 2D데이터 API(req/data)는 인증키가 서비스URL로 등록돼 있으면
   * domain 파라미터에 그 URL을 실어 보내지 않으면 INCORRECT_KEY로
   * 거부한다(주소 API(req/address)는 이 검증이 없어 이 사실을 놓치기
   * 쉬웠다 — 실측: domain 파라미터 유무 차이로만 성공/실패가 갈림,
   * 2026-07-21). */
  @Get("land-price")
  async landPrice(
    @Headers() headers: Record<string, string>,
    @Query("x") x: string,
    @Query("y") y: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!x || !y) {
      throw new ServiceUnavailableException("좌표(x, y)가 필요합니다.");
    }
    const url = new URL("https://api.vworld.kr/req/data");
    url.searchParams.set("service", "data");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("data", "LP_PA_CBND_BUBUN");
    url.searchParams.set(
      "domain",
      process.env.VWORLD_REGISTERED_DOMAIN ??
        "https://auction-seven-tan.vercel.app",
    );
    url.searchParams.set(
      "geomFilter",
      `POINT(${x} ${y})`,
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("key", this.apiKey);

    const res = await fetchExternal(this.logger, "VWorld 공시지가 조회", url.toString());
    if (!res.ok) {
      throw new ServiceUnavailableException("VWorld 공시지가 조회 요청 실패");
    }
    return res.json();
  }

  /** PNU(19자리 고유번호) 기준 건축물대장 조회 — 건물 면적·신축연도·구조·
   * 주용도를 자동으로 채우는 데 쓴다. PNU는 VWorld 주소 변환 응답의
   * structure.level4LC 필드에서 얻는다.
   *
   * 표제부(getBrTitleInfo)는 집합건물(아파트 단지 등) 전체 필지의 모든
   * 동·부속건축물(경비실/관리동/지하주차장 등)을 뒤섞어 반환하고, 순서도
   * 보장되지 않는다 — 그냥 items[0]을 쓰면 엉뚱한 동(경비실 등)이 걸릴
   * 수 있다(실측: 이 문제로 건물 면적이 7.29㎡(경비실)로 잘못 채워짐,
   * 2026-07-21). 동/호가 주어지면 전유부(getBrExposPubuseAreaInfo)로
   * 정확히 그 세대의 전유(exposPubuseGbCd=1) + 공용(=2) 면적 합을
   * 구한다 — 원본 사이트(atomtax-app)의 "전유+공용 자동 합산" 결과와
   * 실측 대조로 정확히 일치함을 확인(166.82㎡ = 전유 105.14 + 공용
   * 61.68). 동/호가 없으면(단독주택 등) 표제부의 총 연면적(totArea)을
   * 그대로 쓴다. */
  @Get("building-register")
  async buildingRegister(
    @Headers() headers: Record<string, string>,
    @Query("pnu") pnu: string,
    @Query("dong") dong?: string,
    @Query("ho") ho?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!pnu || pnu.trim().length !== 19) {
      throw new ServiceUnavailableException("올바른 PNU(19자리)가 필요합니다.");
    }
    const trimmed = pnu.trim();
    const sigunguCd = trimmed.slice(0, 5);
    const bjdongCd = trimmed.slice(5, 10);
    const bun = trimmed.slice(11, 15);
    const ji = trimmed.slice(15, 19);

    const key = process.env.BUILDING_REGISTER_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        "건축물대장 API 키가 설정되지 않았습니다.",
      );
    }

    if (dong?.trim() && ho?.trim()) {
      const exposed = await this.fetchExposedArea(
        key,
        { sigunguCd, bjdongCd, bun, ji },
        dong.trim(),
        ho.trim(),
      );
      if (exposed) {
        // 전유부 API에는 사용승인일(신축연도)이 없다 — 표제부에서 동
        // 이름이 일치하는 항목을 찾아 보강한다(항상 성공하지 않아도
        // 면적은 이미 정확하므로 실패해도 무시).
        const titleUseAprDay = await this.findUseAprDayByDong(
          key,
          { sigunguCd, bjdongCd, bun, ji },
          dong.trim(),
        );
        return {
          ...exposed,
          useAprDay: titleUseAprDay ?? exposed.useAprDay,
          housingLedgerDongNm: exposed.housingLedgerPk
            ? dong.trim().endsWith("동")
              ? dong.trim()
              : `${dong.trim()}동`
            : undefined,
        };
      }
      // 동/호로 못 찾으면 표제부로 폴백(사람이 오타를 냈거나 API 표기
      // 형식이 다를 수 있음).
    }

    const item =
      (await this.fetchTitleInfo(key, { sigunguCd, bjdongCd, bun, ji }, "0")) ??
      (await this.fetchTitleInfo(key, { sigunguCd, bjdongCd, bun, ji }, "1"));
    if (!item) {
      throw new ServiceUnavailableException(
        "이 위치의 건축물대장 정보를 찾지 못했습니다.",
      );
    }
    return item;
  }

  private async fetchExposedArea(
    key: string,
    params: { sigunguCd: string; bjdongCd: string; bun: string; ji: string },
    dong: string,
    ho: string,
  ): Promise<{
    totArea: number;
    useAprDay?: string;
    strctCdNm?: string;
    mainPurpsCdNm?: string;
    housingLedgerPk?: string;
  } | null> {
    const dongNm = dong.endsWith("동") ? dong : `${dong}동`;
    // hoNm은 "호" 접미사를 붙이면 매칭이 0건으로 나온다(실측: "2202호"는
    // 0건, 순수 숫자 "2202"는 정상 9건 매칭, 2026-07-21) — dongNm과
    // 달리 순수 숫자만 받는 것으로 보인다.
    const hoNm = ho.replace(/호\s*$/, "").trim();

    // 공공데이터포털 건축물대장 API가 간헐적으로 빈 응답/오류를 준다
    // (실측: 같은 요청을 3회 연속 보냈더니 실패·표제부성 폴백·정상성공이
    // 각각 한 번씩 나옴, 2026-07-21) — "진짜 매칭 없음"과 "일시적 실패"를
    // 구분하기 위해 실패(ok가 아니거나 응답 파싱 불가)는 별도 신호로
    // 반환하고, 호출부가 표제부로 잘못 폴백하지 않도록 최대 2회 재시도한다.
    const fetchOnce = async (
      platGbCd: "0" | "1",
    ): Promise<{ ok: boolean; rows: Record<string, unknown>[] }> => {
      const url = new URL(
        "https://apis.data.go.kr/1613000/BldRgstHubService/getBrExposPubuseAreaInfo",
      );
      url.searchParams.set("sigunguCd", params.sigunguCd);
      url.searchParams.set("bjdongCd", params.bjdongCd);
      url.searchParams.set("platGbCd", platGbCd);
      url.searchParams.set("bun", params.bun);
      url.searchParams.set("ji", params.ji);
      url.searchParams.set("dongNm", dongNm);
      url.searchParams.set("hoNm", hoNm);
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("numOfRows", "50");
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("_type", "json");

      const res = await fetchExternal(
        this.logger,
        "건축물대장(전유부) 조회",
        url.toString(),
      );
      if (!res.ok) return { ok: false, rows: [] };
      try {
        const data = (await res.json()) as {
          response?: {
            header?: { resultCode?: string };
            body?: { items?: { item?: Record<string, unknown>[] } | "" };
          };
        };
        if (data.response?.header?.resultCode !== "00") {
          return { ok: false, rows: [] };
        }
        const items = data.response?.body?.items;
        const rows =
          items && typeof items === "object" && Array.isArray(items.item)
            ? items.item
            : [];
        return { ok: true, rows };
      } catch {
        return { ok: false, rows: [] };
      }
    };

    // 공공데이터포털 건축물대장 API는 resultCode="00"(성공)이면서도 실제
    // 매칭 row가 0건인 응답을 간헐적으로 준다(실측: 106동 501호가 이미
    // 존재를 확인한 세대인데도 5회 중 1회 빈 배열이 옴, 2026-07-21) —
    // ok=true/rows=[]인 경우도 진짜 "매칭 없음"과 구분할 수 없으니
    // 여러 번 더 재시도한다.
    const fetchWithRetry = async (platGbCd: "0" | "1") => {
      let sawEmptySuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await fetchOnce(platGbCd);
        if (result.ok && result.rows.length > 0) return result.rows;
        if (result.ok) sawEmptySuccess = true;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 400));
      }
      return sawEmptySuccess ? [] : null; // null = 진짜 API 실패
    };

    const [rows0, rows1] = await Promise.all([
      fetchWithRetry("0"),
      fetchWithRetry("1"),
    ]);
    if (rows0 === null && rows1 === null) {
      // 두 platGbCd 조회 모두 API 실패 — 표제부로 조용히 폴백하면 엉뚱한
      // 동(경비실 등)의 면적이 나올 수 있으므로 명확히 실패로 알린다.
      throw new ServiceUnavailableException(
        "건축물대장(전유부) 조회에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      );
    }
    const rows = [...(rows0 ?? []), ...(rows1 ?? [])];
    if (rows.length === 0) return null;

    const sum = (gb: string) =>
      rows
        .filter((r) => String(r.exposPubuseGbCd) === gb)
        .reduce((acc, r) => acc + (Number(r.area) || 0), 0);
    // 소수점을 2자리로 반올림하면 최종 부가세 계산 결과가 원본 대비
    // 오차가 생긴다(실측: 166.82㎡로 반올림 시 105,930,700원, 원본
    // 정밀도 166.8163㎡ 그대로 쓰면 105,928,350.5원 — 원본 사이트와
    // 정확히 일치, 2026-07-21) — 반올림 없이 원래 정밀도를 그대로 넘긴다.
    const totArea = sum("1") + sum("2");
    const first = rows[0];
    // mgmBldrgstPk(관리건축물대장PK) — 국토부 주택 공시가격 CSV(2024년분~)가
    // 이 값을 연계키로 제공해, 동/호 단위 정확한 공시가격을 조인하는 데
    // 쓴다(사용자 요청, 2026-08-06: "나이스옥션이 쓰는 방식으로 우리
    // 자체적으로 공시가를 가져올 순 없나?"). API가 숫자로 주므로 문자열로
    // 통일해 저장한다.
    const housingLedgerPk =
      first.mgmBldrgstPk != null && first.mgmBldrgstPk !== ""
        ? String(first.mgmBldrgstPk)
        : undefined;
    return {
      totArea,
      // 전유부 API에는 사용승인일(신축연도) 필드가 없다 — 호출부에서
      // 표제부 조회로 보강한다.
      useAprDay: undefined,
      strctCdNm: typeof first.strctCdNm === "string" ? first.strctCdNm : undefined,
      mainPurpsCdNm:
        typeof first.mainPurpsCdNm === "string" ? first.mainPurpsCdNm : undefined,
      housingLedgerPk,
    };
  }

  /** 표제부 목록에서 동 이름이 일치하는 항목의 사용승인일을 찾는다.
   * dongNm 쿼리 파라미터로 필터링되지 않는(실측: 여전히 전체 목록이
   * 반환됨, 2026-07-21) API 특성상 응답을 순회해 직접 매칭한다. */
  private async findUseAprDayByDong(
    key: string,
    params: { sigunguCd: string; bjdongCd: string; bun: string; ji: string },
    dong: string,
  ): Promise<string | undefined> {
    const dongNm = dong.endsWith("동") ? dong : `${dong}동`;
    const rows = await this.fetchTitleInfoList(key, params, "0");
    const match = rows.find((r) => r.dongNm === dongNm);
    return typeof match?.useAprDay === "string" && match.useAprDay.trim()
      ? match.useAprDay
      : undefined;
  }

  private async fetchTitleInfoList(
    key: string,
    params: { sigunguCd: string; bjdongCd: string; bun: string; ji: string },
    platGbCd: "0" | "1",
  ): Promise<Record<string, unknown>[]> {
    const url = new URL(
      "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
    );
    url.searchParams.set("sigunguCd", params.sigunguCd);
    url.searchParams.set("bjdongCd", params.bjdongCd);
    url.searchParams.set("platGbCd", platGbCd);
    url.searchParams.set("bun", params.bun);
    url.searchParams.set("ji", params.ji);
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("numOfRows", "50");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");

    const res = await fetchExternal(this.logger, "건축물대장 목록 조회", url.toString());
    if (!res.ok) return [];
    const data = (await res.json()) as {
      response?: { body?: { items?: { item?: Record<string, unknown>[] } | "" } };
    };
    const items = data.response?.body?.items;
    return items && typeof items === "object" && Array.isArray(items.item)
      ? items.item
      : [];
  }

  private async fetchTitleInfo(
    key: string,
    params: { sigunguCd: string; bjdongCd: string; bun: string; ji: string },
    platGbCd: "0" | "1",
  ): Promise<Record<string, unknown> | null> {
    const url = new URL(
      "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
    );
    url.searchParams.set("sigunguCd", params.sigunguCd);
    url.searchParams.set("bjdongCd", params.bjdongCd);
    url.searchParams.set("platGbCd", platGbCd);
    url.searchParams.set("bun", params.bun);
    url.searchParams.set("ji", params.ji);
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("numOfRows", "10");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("_type", "json");

    const res = await fetchExternal(this.logger, "건축물대장 조회", url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as {
      response?: { body?: { items?: { item?: Record<string, unknown>[] } | "" } };
    };
    const items = data.response?.body?.items;
    const item =
      items && typeof items === "object" && Array.isArray(items.item)
        ? items.item[0]
        : null;
    return item ?? null;
  }
}
