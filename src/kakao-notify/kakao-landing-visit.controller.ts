import { Body, Controller, Post } from "@nestjs/common";
import { KakaoLandingVisitService } from "./kakao-landing-visit.service";

/**
 * 랜딩페이지(아임웹) 방문 시점에 UTM/리퍼러 정보를 기록하는 공개 엔드포인트.
 * 로그인 전 익명 방문자가 호출하므로 인증이 없다. CORS는 /public/* 경로
 * 전체에 대해 main.ts의 미들웨어가 아임웹 랜딩 도메인만 허용하도록 처리한다.
 */
@Controller("public/kakao-notify")
export class KakaoLandingVisitController {
  constructor(private readonly landingVisitService: KakaoLandingVisitService) {}

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

  @Post("landing-visit/confirm-signup")
  async confirmSignup(@Body() body: { visitId?: string }) {
    return this.landingVisitService.confirmSignup(body.visitId ?? "");
  }
}
