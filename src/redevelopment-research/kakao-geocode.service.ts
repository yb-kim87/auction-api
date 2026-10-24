import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AddressGeocodeCache } from "./entities/address-geocode-cache.entity";

const KAKAO_LOCAL = "https://dapi.kakao.com/v2/local";
const TIMEOUT_MS = 10_000;
const GAP_MS = 80;

export type Geocoded = { lat: number; lng: number; legalDongCode: string | null };

/** 서버(Railway)에서 쓰는 주소 ↔ 좌표 변환. Railway는 VWorld에 연결하지 못하지만(realtor-collect·resale-match
 * 주석 참고) 카카오 로그인이 서버에서 이미 카카오 API를 쓰고 있어 같은 REST 키(KAKAO_REST_API_KEY)로 카카오
 * 로컬 API를 호출한다. 결과가 확정된 주소는 DB에 캐시해 같은 지번을 다시 부르지 않는다. */
@Injectable()
export class KakaoGeocodeService {
  private readonly logger = new Logger(KakaoGeocodeService.name);
  private lastCallAt = 0;
  private readonly jibunMemo = new Map<string, { legalDongCode: string | null; jibun: string | null } | null>();

  constructor(
    @InjectRepository(AddressGeocodeCache)
    private readonly cacheRepo: Repository<AddressGeocodeCache>,
  ) {}

  private get key(): string {
    const k = process.env.KAKAO_REST_API_KEY?.trim();
    if (!k) throw new Error("KAKAO_REST_API_KEY 환경변수가 설정되어 있지 않습니다.");
    return k;
  }

  private async callKakao(path: string, params: Record<string, string>): Promise<any | null> {
    const wait = GAP_MS - (Date.now() - this.lastCallAt);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCallAt = Date.now();
    const url = new URL(`${KAKAO_LOCAL}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { headers: { Authorization: `KakaoAK ${this.key}` }, signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(`카카오 로컬 API ${path} → ${res.status}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      this.logger.warn(`카카오 로컬 API ${path} 실패: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 주소(지번 주소 권장) → 좌표. 결과 없음은 캐시하고, 네트워크 오류는 null만 반환(캐시 안 함). */
  async geocode(address: string): Promise<Geocoded | null> {
    const q = address.trim();
    if (!q) return null;
    const cached = await this.cacheRepo.findOne({ where: { address: q } });
    if (cached) {
      return cached.failed || cached.lat == null || cached.lng == null
        ? null
        : { lat: cached.lat, lng: cached.lng, legalDongCode: cached.legalDongCode };
    }
    const data = await this.callKakao("/search/address.json", { query: q, size: "1" });
    if (!data || !Array.isArray(data.documents)) return null; // 호출 실패 — 캐시하지 않는다
    const doc = data.documents[0];
    const lat = doc ? Number(doc.y) : NaN;
    const lng = doc ? Number(doc.x) : NaN;
    const legalDongCode: string | null = doc?.address?.b_code || null;
    const ok = Number.isFinite(lat) && Number.isFinite(lng);
    await this.cacheRepo
      .save(
        this.cacheRepo.create({
          address: q,
          lat: ok ? lat : null,
          lng: ok ? lng : null,
          legalDongCode: ok ? legalDongCode : null,
          failed: !ok,
          createdAt: new Date(),
        }),
      )
      .catch(() => undefined);
    return ok ? { lat, lng, legalDongCode } : null;
  }

  /** 좌표 → 법정동(10자리 코드 + 동 이름). 구역 경계 샘플 점이 걸치는 동을 알아내는 데 쓴다. */
  async legalDongAt(lat: number, lng: number): Promise<{ code: string; name: string; gu: string } | null> {
    const data = await this.callKakao("/geo/coord2regioncode.json", { x: String(lng), y: String(lat) });
    const b = Array.isArray(data?.documents) ? data.documents.find((d: any) => d.region_type === "B") : null;
    if (!b?.code) return null;
    return { code: String(b.code), name: String(b.region_3depth_name ?? ""), gu: String(b.region_2depth_name ?? "") };
  }

  /** 좌표 → 지번(본번-부번) + 법정동코드. 네이버 매물 좌표로 공시가격을 매칭할 때 쓴다. */
  async jibunAt(lat: number, lng: number): Promise<{ legalDongCode: string | null; jibun: string | null } | null> {
    const memoKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (this.jibunMemo.has(memoKey)) return this.jibunMemo.get(memoKey) ?? null;
    const data = await this.callKakao("/geo/coord2address.json", { x: String(lng), y: String(lat) });
    if (!data || !Array.isArray(data.documents)) return null;
    const a = data.documents[0]?.address;
    // coord2address 응답에는 법정동코드(b_code)가 없다 — 지역 조회(coord2regioncode)로 채운다(공시가격 매칭에 필요).
    const region = a ? await this.legalDongAt(lat, lng) : null;
    const result = a
      ? {
          legalDongCode: a.b_code ? String(a.b_code) : region?.code ?? null,
          jibun: a.main_address_no ? `${a.main_address_no}${a.sub_address_no ? `-${a.sub_address_no}` : ""}` : null,
        }
      : null;
    this.jibunMemo.set(memoKey, result);
    return result;
  }
}
