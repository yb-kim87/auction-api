import {
  Controller,
  Get,
  Headers,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";

/** 부가세 계산기(admin CrawlerVatTab)의 "주소 검색 → 토지공시지가 자동조회"
 * 기능이 VWorld(국토교통부 공간정보 오픈플랫폼) API를 호출한다. API 키를
 * 프론트에 그대로 노출하지 않기 위해 백엔드에서 대신 호출하는 프록시.
 * atomtax-app.vercel.app을 실측 분석해 확인한 것과 동일한 API
 * (api.vworld.kr/req/address, req/data)를 사용한다(2026-07-21). */
@Controller("vat")
export class VatController {
  private get apiKey(): string {
    const key = process.env.VWORLD_API_KEY;
    if (!key) {
      throw new ServiceUnavailableException(
        "VWorld API 키가 설정되지 않았습니다.",
      );
    }
    return key;
  }

  /** 도로명주소 → 지번(PARCEL) 좌표 변환. 카카오 우편번호 팝업에서 도로명
   * 주소를 선택한 뒤, 이 좌표로 개별공시지가를 조회하기 위한 중간 단계. */
  @Get("address-to-coord")
  async addressToCoord(
    @Headers() headers: Record<string, string>,
    @Query("address") address: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!address?.trim()) {
      throw new ServiceUnavailableException("주소가 필요합니다.");
    }
    const url = new URL("https://api.vworld.kr/req/address");
    url.searchParams.set("service", "address");
    url.searchParams.set("request", "getCoord");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("type", "PARCEL");
    url.searchParams.set("address", address.trim());
    url.searchParams.set("format", "json");
    url.searchParams.set("key", this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new ServiceUnavailableException("VWorld 주소 변환 요청 실패");
    }
    return res.json();
  }

  /** 좌표(경도/위도) 기준 개별공시지가 조회(원/㎡). VWorld data API의
   * ladfrlVal(개별공시지가) 레이어를 사용한다. */
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
      "geomFilter",
      `POINT(${x} ${y})`,
    );
    url.searchParams.set("format", "json");
    url.searchParams.set("key", this.apiKey);

    const res = await fetch(url.toString());
    if (!res.ok) {
      throw new ServiceUnavailableException("VWorld 공시지가 조회 요청 실패");
    }
    return res.json();
  }

  /** PNU(19자리 고유번호) 기준 건축물대장 표제부 조회 — 건물 면적(연면적)·
   * 신축연도(사용승인일)·구조·주용도를 자동으로 채우는 데 쓴다. PNU는
   * VWorld 주소 변환 응답의 structure.level4LC 필드에서 얻는다. 공공
   * 데이터포털 "건축물대장정보 서비스(建築HUB)" API를 그대로 프록시한다
   * (실측 확인, 2026-07-21) — platGbCd(대지/산 여부)가 PNU의 11번째
   * 자리와 항상 일치하지는 않아 0(대지)을 먼저 시도하고 결과가 없으면
   * 1(산)로 재시도한다. */
  @Get("building-register")
  async buildingRegister(
    @Headers() headers: Record<string, string>,
    @Query("pnu") pnu: string,
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

    const fetchOnce = async (platGbCd: "0" | "1") => {
      const url = new URL(
        "https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo",
      );
      url.searchParams.set("sigunguCd", sigunguCd);
      url.searchParams.set("bjdongCd", bjdongCd);
      url.searchParams.set("platGbCd", platGbCd);
      url.searchParams.set("bun", bun);
      url.searchParams.set("ji", ji);
      url.searchParams.set("serviceKey", key);
      url.searchParams.set("numOfRows", "10");
      url.searchParams.set("pageNo", "1");
      url.searchParams.set("_type", "json");

      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = (await res.json()) as {
        response?: {
          body?: { items?: { item?: unknown[] } | "" };
        };
      };
      const items = data.response?.body?.items;
      const item =
        items && typeof items === "object" && Array.isArray(items.item)
          ? items.item[0]
          : null;
      return item ?? null;
    };

    const item = (await fetchOnce("0")) ?? (await fetchOnce("1"));
    if (!item) {
      throw new ServiceUnavailableException(
        "이 위치의 건축물대장 정보를 찾지 못했습니다.",
      );
    }
    return item;
  }
}
