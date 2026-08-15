import { Body, Controller, Get, Headers, Patch } from "@nestjs/common";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";
import { SiteSettingsService } from "./site-settings.service";

/** 사이트 전역 설정 — 조회는 로그인한 회원 누구나(물건 상세 화면에서
 * "등기·임차인 정보 숨김" 여부를 확인해야 하므로), 수정은 관리자만
 * (사용자 요청, 2026-08-08). */
@Controller("settings")
export class SiteSettingsController {
  constructor(private readonly service: SiteSettingsService) {}

  @Get()
  async get(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.service.get();
  }

  @Patch()
  async update(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      hideRegistryTenantForStudents?: boolean;
      assignmentNotifyEnabled?: boolean;
      assignmentNotifyCoachPhone?: string;
      assignmentCreatedTemplateCode?: string;
      coachFeedbackTemplateCode?: string;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.update(body);
  }
}
