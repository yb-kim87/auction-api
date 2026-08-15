import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { WebinarAuthService } from "./webinar-auth.service";
import { WebinarEmailAuthService, type JoinEmailInput } from "./webinar-email-auth.service";

@Controller("webinar-auth")
export class WebinarAuthController {
  constructor(
    private readonly service: WebinarAuthService,
    private readonly emailService: WebinarEmailAuthService,
  ) {}

  /** 프론트의 /auth/kakao/callback 페이지가 인가 코드를 받아 이 엔드포인트로
   * 전달하면, 서버가 카카오와 직접 통신해 토큰 교환 + 사용자 정보 조회를
   * 수행한다(클라이언트에 시크릿을 노출하지 않기 위함). */
  @Post("kakao/callback")
  async kakaoCallback(@Body() body: { code?: string }) {
    const lead = await this.service.handleCallback(body.code ?? "");
    return {
      nickname: lead.nickname,
      email: lead.email,
    };
  }

  /** 관리자 페이지 "웨비나 신청자" 탭 전용(카카오 로그인 신청자). */
  @Get("kakao/leads")
  async listLeads(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.findAll();
  }

  /** /courses/webinar/join/form (ID/PW 회원가입 폼) 제출 처리. */
  @Post("email/join")
  async emailJoin(@Body() body: JoinEmailInput) {
    const lead = await this.emailService.join(body);
    return { name: lead.name, email: lead.email };
  }

  /** 관리자 페이지 "웨비나 신청자" 탭 전용(이메일 가입 신청자). */
  @Get("email/leads")
  async listEmailLeads(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.emailService.findAll();
  }
}
