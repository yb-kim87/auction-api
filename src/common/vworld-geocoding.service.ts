import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

/** fetch 실패(TypeError, 예: undici 레벨 연결 오류)는 기본적으로 원인이
 * 로그에 안 찍혀 원인 파악이 어렵다(실측: Railway에서 VWorld 호출이
 * "fetch failed"로만 남고 원인 불명, 2026-07-21) — cause까지 로그에
 * 남긴다. vat.controller.ts의 fetchExternal과 동일한 목적. */
async function fetchExternal(logger: Logger, label: string, url: string): Promise<Response> {
  try {
    return await fetch(url);
  } catch (err) {
    const cause = err instanceof Error ? ((err as { cause?: unknown }).cause ?? err.message) : err;
    logger.error(`${label} 호출 실패: ${JSON.stringify(cause)}`);
    throw new ServiceUnavailableException(`${label} 서버에 연결하지 못했습니다.`);
  }
}

export type VWorldCoordResult = { lat: number; lng: number; pnu: string | null };

/** 주소 → 좌표(위도/경도) + PNU(필지고유번호) 조회. vat.controller.ts의
 * "도로명주소 → 좌표 → PNU" 2단계 로직과 동일한 VWorld API를 쓰지만,
 * 물건 상세의 외부 참고링크(부동산플래닛 등, 2026-08-10)용으로 관리자
 * 권한 없이도 호출 가능한 형태로 별도 서비스로 분리했다. */
@Injectable()
export class VWorldGeocodingService {
  private readonly logger = new Logger(VWorldGeocodingService.name);

  private get apiKey(): string {
    const key = process.env.VWORLD_API_KEY;
    if (!key) throw new ServiceUnavailableException("VWorld API 키가 설정되지 않았습니다.");
    return key;
  }

  async addressToCoord(address: string): Promise<VWorldCoordResult | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;

    const coordUrl = new URL("https://api.vworld.kr/req/address");
    coordUrl.searchParams.set("service", "address");
    coordUrl.searchParams.set("request", "getCoord");
    coordUrl.searchParams.set("version", "2.0");
    coordUrl.searchParams.set("crs", "EPSG:4326");
    coordUrl.searchParams.set("type", "ROAD");
    coordUrl.searchParams.set("address", trimmed);
    coordUrl.searchParams.set("format", "json");
    coordUrl.searchParams.set("key", this.apiKey);

    const coordRes = await fetchExternal(this.logger, "VWorld 주소 변환", coordUrl.toString());
    if (!coordRes.ok) return null;
    const coordData = (await coordRes.json()) as {
      response?: { status?: string; result?: { point?: { x?: string; y?: string } } };
    };
    const point = coordData.response?.result?.point;
    if (coordData.response?.status !== "OK" || !point?.x || !point?.y) return null;

    const lng = Number(point.x);
    const lat = Number(point.y);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    const reverseUrl = new URL("https://api.vworld.kr/req/address");
    reverseUrl.searchParams.set("service", "address");
    reverseUrl.searchParams.set("request", "getAddress");
    reverseUrl.searchParams.set("version", "2.0");
    reverseUrl.searchParams.set("crs", "EPSG:4326");
    reverseUrl.searchParams.set("point", `${point.x},${point.y}`);
    reverseUrl.searchParams.set("type", "PARCEL");
    reverseUrl.searchParams.set("format", "json");
    reverseUrl.searchParams.set("key", this.apiKey);

    let pnu: string | null = null;
    const reverseRes = await fetchExternal(this.logger, "VWorld 역지오코딩", reverseUrl.toString());
    if (reverseRes.ok) {
      const reverseData = (await reverseRes.json()) as {
        response?: { status?: string; result?: { structure?: { level4LC?: string; level5?: string } }[] };
      };
      const structure = reverseData.response?.result?.[0]?.structure;
      const dongCode = structure?.level4LC?.trim();
      const [bunRaw, jiRaw] = (structure?.level5 ?? "").split("-");
      if (dongCode && bunRaw) {
        const bun = bunRaw.padStart(4, "0").slice(-4);
        const ji = (jiRaw ?? "0").padStart(4, "0").slice(-4);
        pnu = `${dongCode}1${bun}${ji}`;
      }
    }

    return { lat, lng, pnu };
  }
}
