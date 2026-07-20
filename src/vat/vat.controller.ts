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
}
