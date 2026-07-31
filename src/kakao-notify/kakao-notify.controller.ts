import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";
import { KakaoNotifySettingService, LEAD_FIELD_OPTIONS } from "./kakao-notify-setting.service";
import { SolapiService } from "./solapi.service";
import { ImwebSyncService } from "./imweb-sync.service";
import { InstagramSyncService } from "./instagram-sync.service";
import { ManualLeadSyncService } from "./manual-lead-sync.service";
import { KakaoSyncRunnerService } from "./kakao-sync-runner.service";
import { KakaoNotifyScheduler } from "./kakao-notify.scheduler";
import { TelegramAlertService } from "./telegram-alert.service";
import { KakaoScheduledDispatchService } from "./kakao-scheduled-dispatch.service";
import { KakaoAdCreativeService } from "./kakao-ad-creative.service";
import { KakaoLandingVisit } from "./kakao-landing-visit.entity";
import { KakaoLandingVisitService } from "./kakao-landing-visit.service";
import type { KakaoLeadSource } from "./kakao-lead.entity";

@Controller("kakao-notify")
export class KakaoNotifyController {
  constructor(
    private readonly kakaoNotifyService: KakaoNotifyService,
    private readonly syncStateService: KakaoSyncStateService,
    private readonly settingService: KakaoNotifySettingService,
    private readonly solapi: SolapiService,
    private readonly imwebSync: ImwebSyncService,
    private readonly instagramSync: InstagramSyncService,
    private readonly manualLeadSync: ManualLeadSyncService,
    private readonly syncRunner: KakaoSyncRunnerService,
    private readonly scheduler: KakaoNotifyScheduler,
    private readonly telegramAlert: TelegramAlertService,
    private readonly scheduledDispatchService: KakaoScheduledDispatchService,
    private readonly adCreativeService: KakaoAdCreativeService,
    private readonly landingVisitService: KakaoLandingVisitService,
    @InjectRepository(KakaoLandingVisit)
    private readonly landingVisitRepo: Repository<KakaoLandingVisit>,
  ) {}

  /** TEMP: 랜딩 방문 기록 진단용. 확인 후 제거 예정. */
  @Get("landing-visits-debug")
  async debugLandingVisits(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.landingVisitRepo.find({ order: { createdAt: "DESC" }, take: 10 });
  }

  /** TEMP: utmContent 필드 추가 이전에 매칭된 기존 리드 백필용. 실행 후 제거 예정. */
  @Post("landing-visits/backfill-utm-content")
  async backfillUtmContent(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.landingVisitService.backfillUtmContent();
  }

  @Post("telegram/test")
  async testTelegramAlert(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    if (!this.telegramAlert.isConfigured()) {
      throw new BadRequestException(
        "텔레그램 알림이 설정되지 않았습니다. TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID를 확인해 주세요.",
      );
    }
    await this.telegramAlert.send("🔔 알림톡 관리 시스템 테스트 알림입니다. 정상적으로 수신되면 설정이 완료된 것입니다.");
    return { ok: true };
  }

  @Get("scheduler/status")
  async getSchedulerStatus(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return {
      enabled: await this.scheduler.isEnabled(),
      intervalMinutes: await this.scheduler.getIntervalMinutes(),
    };
  }

  @Post("scheduler/toggle")
  async toggleScheduler(
    @Headers() headers: Record<string, string>,
    @Body() body: { enabled?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    await this.scheduler.setEnabled(body.enabled === true);
    return { enabled: body.enabled === true };
  }

  @Post("scheduler/interval")
  async setSchedulerInterval(
    @Headers() headers: Record<string, string>,
    @Body() body: { intervalMinutes?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.intervalMinutes || !Number.isFinite(body.intervalMinutes)) {
      throw new BadRequestException("올바른 간격(분)을 입력해 주세요.");
    }
    const intervalMinutes = await this.scheduler.setIntervalMinutes(body.intervalMinutes);
    return { intervalMinutes };
  }

  @Get("leads")
  async findLeads(
    @Headers() headers: Record<string, string>,
    @Query("source") source?: string,
    @Query("channel") channel?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("group") group?: string,
    @Query("joinedFrom") joinedFrom?: string,
    @Query("joinedTo") joinedTo?: string,
    @Query("duplicateOnly") duplicateOnly?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.findLeads({
      source: (source as KakaoLeadSource) || undefined,
      channel: channel || undefined,
      status: status || undefined,
      search: search || undefined,
      group: group || undefined,
      joinedFrom: joinedFrom || undefined,
      joinedTo: joinedTo || undefined,
      duplicateOnly: duplicateOnly === "true",
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }

  @Get("leads/ids")
  async findLeadIds(
    @Headers() headers: Record<string, string>,
    @Query("source") source?: string,
    @Query("channel") channel?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("group") group?: string,
    @Query("joinedFrom") joinedFrom?: string,
    @Query("joinedTo") joinedTo?: string,
    @Query("duplicateOnly") duplicateOnly?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.findLeadIds({
      source: (source as KakaoLeadSource) || undefined,
      channel: channel || undefined,
      status: status || undefined,
      search: search || undefined,
      group: group || undefined,
      joinedFrom: joinedFrom || undefined,
      duplicateOnly: duplicateOnly === "true",
      joinedTo: joinedTo || undefined,
    });
  }

  @Get("leads/channels")
  async findChannels(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.findDistinctChannels();
  }

  @Get("leads/groups")
  async findGroupLabels(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.findGroupLabels();
  }

  @Post("leads/:id/group")
  async setGroupLabel(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { groupLabel?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.setGroupLabel(id, body.groupLabel ?? "");
  }

  @Post("leads/group-bulk")
  async setGroupLabelBulk(
    @Headers() headers: Record<string, string>,
    @Body() body: { ids?: string[]; groupLabel?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    const ids = (body.ids ?? []).filter((id) => typeof id === "string" && id.trim());
    if (ids.length === 0) {
      throw new BadRequestException("그룹을 지정할 고객을 선택해 주세요.");
    }
    return this.kakaoNotifyService.setGroupLabelBulk(ids, body.groupLabel ?? "");
  }

  @Get("leads/daily-stats")
  async getDailyStats(
    @Headers() headers: Record<string, string>,
    @Query("days") days?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.getDailyStats({
      days: days ? Math.min(366, Math.max(1, Number(days) || 14)) : undefined,
      from: from || undefined,
      to: to || undefined,
    });
  }

  @Post("leads/:id/bulk-exclusion")
  async setBulkExclusion(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { excluded?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.setBulkExclusion(id, body.excluded === true);
  }

  @Get("ad-creatives")
  async listAdCreatives(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.adCreativeService.findAll();
  }

  @Post("ad-creatives")
  async upsertAdCreative(
    @Headers() headers: Record<string, string>,
    @Body()
    body: { adName?: string; label?: string; mediaUrl?: string; mediaType?: "image" | "video" },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.adCreativeService.upsert({
      adName: body.adName ?? "",
      label: body.label,
      mediaUrl: body.mediaUrl ?? "",
      mediaType: body.mediaType === "video" ? "video" : "image",
    });
  }

  @Post("ad-creatives/:id/delete")
  async deleteAdCreative(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.adCreativeService.delete(id);
  }

  @Get("leads/:id")
  async getLead(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.getLeadWithLogs(id);
  }

  @Post("leads/:id/resend")
  async resend(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.kakaoNotifyService.resendToLead(id, ctx.username);
  }

  @Post("test-send")
  async testSend(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      name?: string;
      phone?: string;
      channel?: "alimtalk" | "sms";
      templateCode?: string;
      templateName?: string;
      smsText?: string;
      variables?: Record<string, string>;
      scheduledAt?: string;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    if (!body.phone?.trim()) {
      throw new BadRequestException("전화번호를 입력해 주세요.");
    }
    const channel = body.channel ?? "alimtalk";
    if (body.scheduledAt) {
      if (channel === "sms") {
        if (!body.smsText?.trim()) throw new BadRequestException("문자 내용을 입력해 주세요.");
      } else if (!body.templateCode?.trim()) {
        throw new BadRequestException("템플릿을 선택해 주세요.");
      }
      return this.scheduledDispatchService.createTestSchedule({
        name: body.name ?? "",
        phone: body.phone,
        channel,
        templateCode: body.templateCode,
        templateName: body.templateName ?? "",
        smsText: body.smsText,
        variables: body.variables ?? {},
        scheduledAt: new Date(body.scheduledAt),
        adminUsername: ctx.username,
      });
    }
    return this.kakaoNotifyService.testSend({
      name: body.name ?? "",
      rawPhone: body.phone,
      adminUsername: ctx.username,
      channel,
      templateCode: body.templateCode,
      smsText: body.smsText,
      variables: body.variables,
    });
  }

  @Get("templates")
  async listTemplates(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.solapi.listTemplates();
  }

  @Get("settings")
  async getSettings(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.settingService.getDefault();
  }

  @Get("lead-fields")
  async getLeadFields(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return LEAD_FIELD_OPTIONS;
  }

  @Post("settings")
  async updateSetting(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      templateCode?: string;
      templateName?: string;
      variables?: Record<string, string>;
      templateNameVar?: string;
      channel?: "alimtalk" | "sms";
      smsText?: string;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.settingService.upsertDefault({
      templateCode: body.templateCode ?? "",
      templateName: body.templateName ?? "",
      variables: body.variables ?? {},
      templateNameVar: body.templateNameVar,
      channel: body.channel,
      smsText: body.smsText,
    });
  }

  @Get("dispatch-logs")
  async findDispatchLogs(
    @Headers() headers: Record<string, string>,
    @Query("result") result?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.kakaoNotifyService.findDispatchLogs({
      result: result || undefined,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }

  @Get("sync-state")
  async getSyncState(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.syncStateService.findAll();
  }


  /** 아임웹 + 인스타를 동시에(각각 독립적으로) 실행해 신규 리드를 자동 발송한다. */
  @Post("sync/run-now")
  async runNowAll(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const [imweb, instagram] = await Promise.allSettled([
      this.imwebSync.syncNewMembers(),
      this.instagramSync.syncNewRows(),
    ]);
    return {
      imweb: imweb.status === "fulfilled" ? imweb.value : { error: String(imweb.reason?.message ?? imweb.reason) },
      instagram:
        instagram.status === "fulfilled"
          ? instagram.value
          : { error: String(instagram.reason?.message ?? instagram.reason) },
    };
  }

  /** 아임웹 또는 인스타 한쪽만 개별 실행한다. */
  @Post("sync/run-now/:source")
  async runNowOne(
    @Headers() headers: Record<string, string>,
    @Param("source") source: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (source === "imweb") {
      return this.imwebSync.syncNewMembers();
    }
    if (source === "instagram") {
      return this.instagramSync.syncNewRows();
    }
    throw new BadRequestException("알 수 없는 유입경로입니다.");
  }

  @Post("sync/cancel")
  async cancelAll(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    for (const source of ["imweb", "instagram"] as const) {
      try {
        this.syncRunner.requestCancel(source);
      } catch {
        // 진행 중이 아니면 무시
      }
    }
    return { ok: true };
  }

  @Post("sync/cancel/:source")
  async cancelOne(
    @Headers() headers: Record<string, string>,
    @Param("source") source: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (source !== "imweb" && source !== "instagram") {
      throw new BadRequestException("알 수 없는 유입경로입니다.");
    }
    this.syncRunner.requestCancel(source);
    return { ok: true };
  }

  @Get("sync/status")
  async getSyncRunStatus(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return {
      imweb: this.syncRunner.getStatus("imweb"),
      instagram: this.syncRunner.getStatus("instagram"),
    };
  }

  @Post("imweb/backfill-existing")
  async backfillImwebExisting(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.imwebSync.backfillExistingMembers();
  }

  @Post("leads/delete-by-source/:source")
  async deleteLeadsBySource(
    @Headers() headers: Record<string, string>,
    @Param("source") source: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (source !== "imweb" && source !== "instagram" && source !== "manual_sheet") {
      throw new BadRequestException("알 수 없는 유입경로입니다.");
    }
    return this.kakaoNotifyService.deleteLeadsBySource(source as KakaoLeadSource);
  }

  @Post("leads/delete")
  async deleteLeads(
    @Headers() headers: Record<string, string>,
    @Body() body: { ids?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    const ids = (body.ids ?? []).filter((id) => typeof id === "string" && id.trim());
    if (ids.length === 0) {
      throw new BadRequestException("삭제할 고객을 선택해 주세요.");
    }
    return this.kakaoNotifyService.deleteLeadsByIds(ids);
  }

  @Post("leads/bulk-send")
  async bulkSend(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      ids?: string[];
      channel?: "alimtalk" | "sms";
      templateCode?: string;
      templateName?: string;
      smsText?: string;
      variables?: Record<string, string>;
      templateNameVar?: string;
      scheduledAt?: string;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    const ids = (body.ids ?? []).filter((id) => typeof id === "string" && id.trim());
    if (ids.length === 0) {
      throw new BadRequestException("발송할 고객을 선택해 주세요.");
    }
    const channel = body.channel ?? "alimtalk";
    if (channel === "sms") {
      if (!body.smsText?.trim()) throw new BadRequestException("문자 내용을 입력해 주세요.");
    } else if (!body.templateCode?.trim()) {
      throw new BadRequestException("템플릿을 선택해 주세요.");
    }
    if (body.scheduledAt) {
      return this.scheduledDispatchService.createBulkSchedule({
        leadIds: ids,
        channel,
        templateCode: body.templateCode,
        templateName: body.templateName ?? "",
        smsText: body.smsText,
        variables: body.variables ?? {},
        templateNameVar: body.templateNameVar,
        scheduledAt: new Date(body.scheduledAt),
        adminUsername: ctx.username,
      });
    }
    return this.kakaoNotifyService.dispatchBulk({
      leadIds: ids,
      channel,
      templateCode: body.templateCode,
      smsText: body.smsText,
      variables: body.variables ?? {},
      templateNameVar: body.templateNameVar,
      adminUsername: ctx.username,
    });
  }

  @Get("scheduled-dispatches")
  async listScheduledDispatches(
    @Headers() headers: Record<string, string>,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.scheduledDispatchService.list({
      status: status || undefined,
      page: Math.max(1, Number(page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
    });
  }

  @Post("scheduled-dispatches/:id/cancel")
  async cancelScheduledDispatch(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.scheduledDispatchService.cancel(id, ctx.username);
  }

  @Get("instagram/sheet-config")
  async getInstagramSheetConfig(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.instagramSync.getSheetConfig();
  }

  @Post("instagram/backfill-existing")
  async backfillInstagramExisting(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.instagramSync.backfillExistingRows();
  }

  @Post("instagram/sheet-config")
  async setInstagramSheetConfig(
    @Headers() headers: Record<string, string>,
    @Body() body: { spreadsheetId?: string; sheetRange?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.spreadsheetId?.trim()) {
      throw new BadRequestException("구글시트 ID를 입력해 주세요.");
    }
    await this.instagramSync.setSheetConfig(
      body.spreadsheetId,
      body.sheetRange ?? "시트1!A2:I",
    );
    return this.instagramSync.getSheetConfig();
  }

  @Get("manual-sheet/config")
  async getManualSheetConfig(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.manualLeadSync.getSheetConfig();
  }

  @Post("manual-sheet/config")
  async setManualSheetConfig(
    @Headers() headers: Record<string, string>,
    @Body() body: { spreadsheetId?: string; sheetRange?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.spreadsheetId?.trim()) {
      throw new BadRequestException("구글시트 ID를 입력해 주세요.");
    }
    await this.manualLeadSync.setSheetConfig(
      body.spreadsheetId,
      body.sheetRange ?? "시트1!A1:Z",
    );
    return this.manualLeadSync.getSheetConfig();
  }

  @Post("manual-sheet/apply")
  async applyManualSheet(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.manualLeadSync.applyNow();
  }
}
