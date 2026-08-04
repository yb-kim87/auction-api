import { Injectable, Logger } from "@nestjs/common";

/** 매도분석 결과를 지도에 표시하기 위한 주소→좌표 변환. VWorld(국토교통부
 * 공간정보 오픈플랫폼) API를 쓴다 — VatController(부가세 계산기)가 이미
 * 같은 API를 백엔드(Railway)에서 직접 호출해 정상 동작 중이라(주소→PNU
 * 조회, `VWORLD_API_KEY` 재사용), 프론트 API Route(Vercel icn1 리전
 * 강제 우회)를 거칠 필요 없이 백엔드에서 바로 호출한다.
 *
 * 우리 주소는 city+district+umdNm+jibun 조합("서울특별시 강서구 화곡동
 * 380-3")으로, 지번 주소만 다루므로 ROAD 타입 시도 없이 항상 PARCEL로
 * 조회한다(auction/src/app/api/vat/address-to-coord의 ROAD/PARCEL 분기
 * 로직과 달리, 여기 입력은 애초에 도로명 형태가 아니라 단순화). 실패하면
 * VWorld search API로 유사 주소를 찾아 재시도한다(행정구역 개편 등으로
 * 옛 주소가 NOT_FOUND 나는 경우 대응, 2026-07-21 VAT 쪽에서와 동일 이유). */
@Injectable()
export class GeocodeService {
  private readonly logger = new Logger(GeocodeService.name);

  private get apiKey(): string | null {
    return process.env.VWORLD_API_KEY?.trim() || null;
  }

  async geocode(address: string): Promise<{ latitude: number; longitude: number } | null> {
    const key = this.apiKey;
    if (!key || !address.trim()) return null;

    const point = await this.tryGetCoord(address, "PARCEL", key);
    if (point) return point;

    const roadAddress = await this.searchRoadAddress(address, key);
    if (roadAddress) {
      const viaSearch = await this.tryGetCoord(roadAddress, "ROAD", key);
      if (viaSearch) return viaSearch;
    }
    return null;
  }

  private async tryGetCoord(
    address: string,
    type: "ROAD" | "PARCEL",
    key: string,
  ): Promise<{ latitude: number; longitude: number } | null> {
    const url = new URL("https://api.vworld.kr/req/address");
    url.searchParams.set("service", "address");
    url.searchParams.set("request", "getCoord");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("type", type);
    url.searchParams.set("address", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("key", key);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = (await res.json()) as {
        response?: { status?: string; result?: { point?: { x?: string; y?: string } } };
      };
      const p = data.response?.result?.point;
      if (data.response?.status !== "OK" || !p?.x || !p?.y) return null;
      return { latitude: Number(p.y), longitude: Number(p.x) };
    } catch (err) {
      const cause = err instanceof Error ? ((err as { cause?: unknown }).cause ?? err.message) : err;
      this.logger.warn(`VWorld 지오코딩 실패(${address}): ${JSON.stringify(cause)}`);
      return null;
    }
  }

  private async searchRoadAddress(address: string, key: string): Promise<string | null> {
    const url = new URL("https://api.vworld.kr/req/search");
    url.searchParams.set("service", "search");
    url.searchParams.set("request", "search");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("size", "1");
    url.searchParams.set("query", address);
    url.searchParams.set("type", "ADDRESS");
    url.searchParams.set("category", "ROAD");
    url.searchParams.set("format", "json");
    url.searchParams.set("errorFormat", "json");
    url.searchParams.set("key", key);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) return null;
      const data = (await res.json()) as {
        response?: { status?: string; result?: { items?: { address?: { road?: string } }[] } };
      };
      if (data.response?.status !== "OK") return null;
      return data.response.result?.items?.[0]?.address?.road ?? null;
    } catch {
      return null;
    }
  }
}
