import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";

/** fetch 실패(TypeError, 예: undici 레벨 연결 오류)는 기본적으로 원인이
 * 로그에 안 찍혀 원인 파악이 어렵다(실측: Railway에서 VWorld 호출이
 * "fetch failed"로만 남고 원인 불명, 2026-07-21) — cause까지 로그에
 * 남긴다. vat.controller.ts의 fetchExternal과 동일한 목적.
 *
 * Railway → VWorld 구간이 간헐적으로 SocketError(UND_ERR_SOCKET,
 * bytesRead:0 — 연결은 됐지만 응답을 못 받음)를 내는 걸 실측
 * 확인했다(2026-08-10, 물건 상세 외부 참고링크가 매번 비어 보인다는
 * 리포트로 재현). 한 번 실패로 바로 포기하면 사용자가 매번 새로고침을
 * 반복해야 하므로, 짧은 간격으로 최대 3번까지 재시도한다. */
async function fetchExternal(logger: Logger, label: string, url: string): Promise<Response> {
  const attempts = 3;
  let lastCause: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fetch(url);
    } catch (err) {
      lastCause = err instanceof Error ? ((err as { cause?: unknown }).cause ?? err.message) : err;
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 300 * i));
    }
  }
  logger.error(`${label} 호출 실패(${attempts}회 재시도 후): ${JSON.stringify(lastCause)}`);
  throw new ServiceUnavailableException(`${label} 서버에 연결하지 못했습니다.`);
}

export type VWorldCoordResult = { lat: number; lng: number; pnu: string | null };

type VWorldCoordApiResponse = {
  response?: {
    status?: string;
    result?: { point?: { x?: string; y?: string } };
    refined?: { structure?: { level4LC?: string; level5?: string } };
  };
};

/** 주소 → 좌표(위도/경도) + PNU(필지고유번호) 조회. 물건 상세의 외부
 * 참고링크(부동산플래닛 등, 2026-08-10)용으로 관리자 권한 없이도 호출
 * 가능한 형태로 vat.controller.ts와 별도 서비스로 분리했다.
 *
 * `auctions.address`는 법원 경매 데이터라 지번주소(+아파트명/동/호)
 * 형태다("인천광역시 미추홀구 숭의동 182-4 다우림 201동 12층1201호")
 * — vat.controller.ts가 쓰는 type=ROAD(도로명주소 전용, 카카오 우편번호
 * 팝업 입력값 기준)로 조회하면 항상 NOT_FOUND가 난다(실측, 2026-08-10:
 * 같은 주소를 ROAD로 조회하면 0건, PARCEL로는 정상 매칭 및 PNU까지
 * 한 번에 반환됨). 그래서 이 서비스는 PARCEL을 우선 시도하고, 실패할
 * 때만 ROAD+역지오코딩 2단계로 폴백한다. */
@Injectable()
export class VWorldGeocodingService {
  private readonly logger = new Logger(VWorldGeocodingService.name);

  private get apiKey(): string {
    const key = process.env.VWORLD_API_KEY;
    if (!key) throw new ServiceUnavailableException("VWorld API 키가 설정되지 않았습니다.");
    return key;
  }

  private buildCoordUrl(address: string, type: "PARCEL" | "ROAD"): string {
    const url = new URL("https://api.vworld.kr/req/address");
    url.searchParams.set("service", "address");
    url.searchParams.set("request", "getCoord");
    url.searchParams.set("version", "2.0");
    url.searchParams.set("crs", "EPSG:4326");
    url.searchParams.set("type", type);
    url.searchParams.set("address", address);
    url.searchParams.set("format", "json");
    url.searchParams.set("key", this.apiKey);
    return url.toString();
  }

  private extractPnu(structure: { level4LC?: string; level5?: string } | undefined): string | null {
    const dongCode = structure?.level4LC?.trim();
    const [bunRaw, jiRaw] = (structure?.level5 ?? "").split("-");
    if (!dongCode || !bunRaw) return null;
    const bun = bunRaw.padStart(4, "0").slice(-4);
    const ji = (jiRaw ?? "0").padStart(4, "0").slice(-4);
    return `${dongCode}1${bun}${ji}`;
  }

  async addressToCoord(address: string): Promise<VWorldCoordResult | null> {
    const trimmed = address.trim();
    if (!trimmed) return null;

    const parcelRes = await fetchExternal(
      this.logger,
      "VWorld 주소 변환(PARCEL)",
      this.buildCoordUrl(trimmed, "PARCEL"),
    );
    if (parcelRes.ok) {
      const parcelData = (await parcelRes.json()) as VWorldCoordApiResponse;
      const point = parcelData.response?.result?.point;
      if (parcelData.response?.status === "OK" && point?.x && point?.y) {
        const lng = Number(point.x);
        const lat = Number(point.y);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return { lat, lng, pnu: this.extractPnu(parcelData.response?.refined?.structure) };
        }
      }
    }

    return this.addressToCoordViaRoad(trimmed);
  }

  private async addressToCoordViaRoad(address: string): Promise<VWorldCoordResult | null> {
    const coordRes = await fetchExternal(this.logger, "VWorld 주소 변환(ROAD)", this.buildCoordUrl(address, "ROAD"));
    if (!coordRes.ok) return null;
    const coordData = (await coordRes.json()) as VWorldCoordApiResponse;
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
        response?: { result?: { structure?: { level4LC?: string; level5?: string } }[] };
      };
      pnu = this.extractPnu(reverseData.response?.result?.[0]?.structure);
    }

    return { lat, lng, pnu };
  }
}
