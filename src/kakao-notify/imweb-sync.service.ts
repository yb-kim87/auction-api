import { Injectable, Logger } from "@nestjs/common";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";
import { KakaoSyncRunnerService } from "./kakao-sync-runner.service";

const IMWEB_AUTH_URL = "https://api.imweb.me/v2/auth";
const IMWEB_MEMBERS_URL = "https://api.imweb.me/v2/member/members";
const PAGE_LIMIT = 100;

export interface ImwebMember {
  member_code?: string;
  name?: string;
  callnum?: string;
  email?: string;
  gender?: string;
  birth?: string;
  addr?: string;
  addr_detail?: string;
  join_time?: string;
  [key: string]: unknown;
}

/**
 * 아임웹 회원 DB 동기화. Make 시나리오의 [아임웹_Key확보] → [아임웹_페이지수확인]
 * → [Repeater] → [아임웹_토큰요청_DB확보] 흐름을 그대로 옮긴 것으로, 인증은
 * OAuth가 아니라 key/secret으로 access_token을 매번 새로 발급받는 방식이다.
 */
@Injectable()
export class ImwebSyncService {
  private readonly logger = new Logger(ImwebSyncService.name);

  private get apiKey() {
    return process.env.IMWEB_API_KEY?.trim() ?? "";
  }

  private get apiSecret() {
    return process.env.IMWEB_API_SECRET?.trim() ?? "";
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret);
  }

  constructor(
    private readonly kakaoNotifyService: KakaoNotifyService,
    private readonly syncStateService: KakaoSyncStateService,
    private readonly runner: KakaoSyncRunnerService,
  ) {}

  private async fetchAccessToken(): Promise<string> {
    const url = `${IMWEB_AUTH_URL}?key=${encodeURIComponent(this.apiKey)}&secret=${encodeURIComponent(this.apiSecret)}`;
    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      data?: { access_token?: string };
      error?: string;
      msg?: string;
    };
    const accessToken = body?.access_token ?? body?.data?.access_token;
    if (!res.ok || !accessToken) {
      this.logger.error(`아임웹 인증 응답 원문: ${JSON.stringify(body)}`);
      throw new Error(
        `아임웹 인증 실패 (HTTP ${res.status}): ${body?.error ?? body?.msg ?? "알 수 없는 오류"}`,
      );
    }
    return accessToken;
  }

  /**
   * page는 1부터 시작하는 페이지 번호(아임웹 API의 offset 파라미터가 실제로는
   * 1-base 페이지 번호). 아임웹 API는 같은 access_token을 여러 페이지에
   * 재사용하면 간헐적으로 HTTP 200이지만 data.list가 빈 비정상 응답을 준다
   * (Make 시나리오도 매 요청마다 토큰을 새로 발급받아 이 문제를 피했음).
   * 그래서 페이지마다 토큰을 새로 발급받고, 그래도 비정상 응답이면 재시도한다.
   */
  private async fetchMembersPage(
    page: number,
  ): Promise<{ members: ImwebMember[]; total: number }> {
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const accessToken = await this.fetchAccessToken();
      const url = `${IMWEB_MEMBERS_URL}?limit=${PAGE_LIMIT}&offset=${page}`;
      const res = await fetch(url, {
        headers: { "access-token": accessToken },
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: {
          list?: ImwebMember[];
          pagenation?: { data_count?: number };
        };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(
          `아임웹 회원 조회 실패 (HTTP ${res.status}): ${body?.error ?? "알 수 없는 오류"}`,
        );
      }

      if (body?.data?.list !== undefined) {
        return {
          members: body.data.list,
          total: body.data.pagenation?.data_count ?? 0,
        };
      }

      lastError = "응답에 data.list가 없음(아임웹 API 일시 오류로 추정)";
      this.logger.warn(`아임웹 회원 조회 비정상 응답(page=${page}, 시도 ${attempt}/3): ${JSON.stringify(body)}`);
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }

    throw new Error(`아임웹 회원 조회 실패(page=${page}): ${lastError}`);
  }

  /**
   * 신규 회원만 동기화한다. 매번 1페이지부터 전체를 훑으면 아임웹 API의
   * 간헐적 오류에 노출될 확률이 커지므로, 마지막으로 확인한 페이지 번호를
   * lastCursor에 저장해두고 그 지점(대략 마지막 페이지 근처)부터만 훑는다.
   * 앞쪽 페이지는 이미 다 수집된 상태라고 가정한다(신규 회원은 항상 뒤쪽
   * 페이지에 쌓이므로).
   */
  async syncNewMembers(): Promise<{ processed: number; created: number }> {
    if (!this.isConfigured()) {
      throw new Error(
        "아임웹 연동이 설정되지 않았습니다. IMWEB_API_KEY/IMWEB_API_SECRET을 확인해 주세요.",
      );
    }

    const state = await this.syncStateService.getOrCreate("imweb");
    this.runner.start("imweb");

    let processed = 0;
    let created = 0;
    let latestJoinedAt: Date | null = state.lastSyncedAt;
    let cancelled = false;
    let lastPageNum = 1;

    try {
      const cursorPage = Number(state.lastCursor) || 0;
      let pageNum = cursorPage > 1 ? cursorPage - 1 : 1;

      outer: while (true) {
        const page = await this.fetchMembersPage(pageNum);
        if (page.members.length === 0) break;
        lastPageNum = pageNum;

        for (const member of page.members) {
          if (this.runner.isCancelRequested("imweb")) {
            cancelled = true;
            break outer;
          }

          processed += 1;
          const joinedAt = member.join_time ? new Date(member.join_time) : null;

          if (
            state.lastSyncedAt &&
            joinedAt &&
            joinedAt.getTime() <= state.lastSyncedAt.getTime()
          ) {
            this.runner.progress("imweb");
            continue;
          }

          const result = await this.kakaoNotifyService.ingestAndDispatch({
            source: "imweb",
            sourceRefId: member.member_code ?? member.callnum ?? "",
            name: member.name ?? "",
            rawPhone: member.callnum ?? "",
            email: member.email ?? "",
            gender: member.gender ?? "",
            birthDate: member.birth ?? "",
            address: [member.addr, member.addr_detail].filter(Boolean).join(" "),
            joinedAt,
            rawPayload: member,
          });
          if (result.outcome === "created" || result.outcome === "resubmitted") created += 1;

          if (joinedAt && (!latestJoinedAt || joinedAt.getTime() > latestJoinedAt.getTime())) {
            latestJoinedAt = joinedAt;
          }
          this.runner.progress("imweb");
        }

        pageNum += 1;
      }
    } finally {
      this.runner.finish("imweb");
    }

    await this.syncStateService.recordRunResult("imweb", {
      status: cancelled ? "error" : "ok",
      errorMessage: cancelled ? "관리자에 의해 중단됨" : null,
      lastSyncedAt: latestJoinedAt,
      lastCursor: String(lastPageNum),
    });

    this.logger.log(`아임웹 동기화 완료: ${processed}건 확인, ${created}건 신규`);
    return { processed, created };
  }

  /**
   * 이미 Make로 알림톡을 발송해온 기존 아임웹 회원 전체를 발송 없이
   * 리드로만 채워넣고 상태를 sent로 표시한다(1회성 백필). 완료 후
   * lastSyncedAt을 최신 가입일로 갱신해, 이후 syncNewMembers는 그
   * 시점 이후 신규 가입자만 자동 발송하게 된다.
   */
  async backfillExistingMembers(): Promise<{ processed: number; created: number }> {
    if (!this.isConfigured()) {
      throw new Error(
        "아임웹 연동이 설정되지 않았습니다. IMWEB_API_KEY/IMWEB_API_SECRET을 확인해 주세요.",
      );
    }

    // 아임웹은 회원을 가입일 오름차순(오래된 순)으로 페이지네이션해서 준다.
    // 1페이지(오래된 회원)부터 순서대로 수집해, 최신 가입자가 가장 나중에
    // 저장되도록(수집시각도 가입일과 같은 순서로 쌓이도록) 한다.
    let processed = 0;
    let created = 0;
    let latestJoinedAt: Date | null = null;
    let lastPageNum = 1;

    for (let pageNum = 1; ; pageNum += 1) {
      const page = await this.fetchMembersPage(pageNum);
      if (page.members.length === 0) break;
      lastPageNum = pageNum;

      const sorted = [...page.members].sort((a, b) =>
        (a.join_time ?? "").localeCompare(b.join_time ?? ""),
      );

      for (const member of sorted) {
        processed += 1;
        const joinedAt = member.join_time ? new Date(member.join_time) : null;

        const result = await this.kakaoNotifyService.backfillLeadAsSent({
          source: "imweb",
          sourceRefId: member.member_code ?? member.callnum ?? "",
          name: member.name ?? "",
          rawPhone: member.callnum ?? "",
          email: member.email ?? "",
          gender: member.gender ?? "",
          birthDate: member.birth ?? "",
          address: [member.addr, member.addr_detail].filter(Boolean).join(" "),
          joinedAt,
          rawPayload: member,
        });
        if (result.outcome === "created" || result.outcome === "resubmitted") created += 1;

        if (joinedAt && (!latestJoinedAt || joinedAt.getTime() > latestJoinedAt.getTime())) {
          latestJoinedAt = joinedAt;
        }
      }
    }

    await this.syncStateService.recordRunResult("imweb", {
      status: "ok",
      lastSyncedAt: latestJoinedAt,
      lastCursor: String(lastPageNum),
    });

    this.logger.log(`아임웹 백필 완료: ${processed}건 확인, ${created}건 신규 저장`);
    return { processed, created };
  }
}
