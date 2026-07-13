import { Body, Controller, Logger, Post } from "@nestjs/common";
import { KakaoLandingVisitService } from "./kakao-landing-visit.service";
import { ImwebSyncService } from "./imweb-sync.service";

/** 가입완료 신호 수신 후 아임웹 회원 API에 신규 회원이 반영되기까지의
 *  전파 지연을 감안해 이 시간만큼 기다렸다가 동기화를 실행한다. */
const SYNC_TRIGGER_DELAY_MS = 15_000;

/**
 * 랜딩페이지(아임웹) 방문 시점에 UTM/리퍼러 정보를 기록하는 공개 엔드포인트.
 * 로그인 전 익명 방문자가 호출하므로 인증이 없다. CORS는 /public/* 경로
 * 전체에 대해 main.ts의 미들웨어가 아임웹 랜딩 도메인만 허용하도록 처리한다.
 */
@Controller("public/kakao-notify")
export class KakaoLandingVisitController {
  private readonly logger = new Logger(KakaoLandingVisitController.name);

  constructor(
    private readonly landingVisitService: KakaoLandingVisitService,
    private readonly imwebSync: ImwebSyncService,
  ) {}

  @Post("landing-visit")
  async recordVisit(
    @Body()
    body: {
      visitId?: string;
      utmSource?: string;
      utmMedium?: string;
      utmCampaign?: string;
      utmContent?: string;
      fbclid?: string;
      landingUrl?: string;
      referrer?: string;
    },
  ) {
    return this.landingVisitService.recordVisit(body);
  }

  /**
   * 가입완료 페이지에서 오는 신호. 정기 폴링(스케줄러)과 별개로, 가입
   * 직후 곧바로 동기화를 한 번 더 트리거해 발송 지연을 줄인다. 응답은
   * 바로 돌려주고 동기화는 백그라운드에서 실행(브라우저를 기다리게 하지
   * 않음). 아임웹 회원 API 반영 지연을 감안해 약간 늦춰서 실행한다.
   */
  @Post("landing-visit/confirm-signup")
  async confirmSignup(@Body() body: { visitId?: string }) {
    const result = await this.landingVisitService.confirmSignup(body.visitId ?? "");
    setTimeout(() => {
      this.imwebSync.syncNewMembers().catch((err) => {
        // 스케줄러 폴링과 겹쳐 "이미 진행 중" 예외가 나는 것은 정상 상황이라 무시한다.
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("이미 동기화가 진행 중")) return;
        this.logger.error(`가입완료 트리거 동기화 실패: ${message}`);
      });
    }, SYNC_TRIGGER_DELAY_MS);
    return result;
  }

  @Post("landing-visit/kakao-room-click")
  async recordKakaoRoomClick(@Body() body: { visitId?: string }) {
    return this.landingVisitService.recordKakaoRoomClick(body.visitId ?? "");
  }
}
