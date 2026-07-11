import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, Repository } from "typeorm";
import { KakaoScheduledDispatch } from "./kakao-scheduled-dispatch.entity";
import { KakaoLead } from "./kakao-lead.entity";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoNotifySettingService } from "./kakao-notify-setting.service";
import { SolapiService } from "./solapi.service";
import { normalizePhone } from "./phone.util";
import { TelegramAlertService } from "./telegram-alert.service";

const TICK_INTERVAL_MS = 30_000;

/**
 * 선택 발송/테스트 발송의 예약건을 관리한다. 실제 처리 틱은 자동수집
 * 스케줄러(ON/OFF 토글)와 무관하게 항상 켜져 있다 — 예약은 사용자가
 * 명시적으로 건 약속이므로, 자동수집을 꺼둔 상태에서도 반드시 그 시각에
 * 발송돼야 하기 때문이다.
 */
@Injectable()
export class KakaoScheduledDispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KakaoScheduledDispatchService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private processing = false;

  constructor(
    @InjectRepository(KakaoScheduledDispatch)
    private readonly repo: Repository<KakaoScheduledDispatch>,
    @InjectRepository(KakaoLead)
    private readonly leadRepo: Repository<KakaoLead>,
    private readonly kakaoNotifyService: KakaoNotifyService,
    private readonly settingService: KakaoNotifySettingService,
    private readonly solapi: SolapiService,
    private readonly telegramAlert: TelegramAlertService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.processDue(), TICK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async createBulkSchedule(input: {
    leadIds: string[];
    templateCode: string;
    templateName: string;
    variables: Record<string, string>;
    templateNameVar?: string;
    scheduledAt: Date;
    adminUsername: string;
  }): Promise<KakaoScheduledDispatch> {
    if (input.leadIds.length === 0) throw new BadRequestException("발송할 고객을 선택해 주세요.");
    if (!input.templateCode.trim()) throw new BadRequestException("템플릿을 선택해 주세요.");
    if (input.scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException("예약 시각은 현재 시각 이후여야 합니다.");
    }
    return this.repo.save(
      this.repo.create({
        kind: "bulk",
        leadIdsJson: JSON.stringify(input.leadIds),
        templateCode: input.templateCode,
        templateName: input.templateName,
        variablesJson: JSON.stringify(input.variables),
        templateNameVar: input.templateNameVar || "회원명",
        scheduledAt: input.scheduledAt,
        status: "scheduled",
        targetCount: input.leadIds.length,
        createdByAdmin: input.adminUsername,
      }),
    );
  }

  async createTestSchedule(input: {
    name: string;
    phone: string;
    templateCode: string;
    templateName: string;
    variables: Record<string, string>;
    scheduledAt: Date;
    adminUsername: string;
  }): Promise<KakaoScheduledDispatch> {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException("전화번호 형식을 확인해 주세요. (예: 010-1234-5678)");
    if (!input.templateCode.trim()) throw new BadRequestException("템플릿을 선택해 주세요.");
    if (input.scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException("예약 시각은 현재 시각 이후여야 합니다.");
    }
    return this.repo.save(
      this.repo.create({
        kind: "test",
        leadIdsJson: "[]",
        testPhone: phone,
        testName: input.name.trim() || "고객",
        templateCode: input.templateCode,
        templateName: input.templateName,
        variablesJson: JSON.stringify(input.variables),
        scheduledAt: input.scheduledAt,
        status: "scheduled",
        targetCount: 1,
        createdByAdmin: input.adminUsername,
      }),
    );
  }

  async cancel(id: string, adminUsername: string): Promise<KakaoScheduledDispatch> {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException("예약 건을 찾을 수 없습니다.");
    if (item.status !== "scheduled") {
      throw new BadRequestException("이미 처리되었거나 취소된 예약입니다.");
    }
    item.status = "canceled";
    item.processedAt = new Date();
    item.errorMessage = `${adminUsername}님이 취소함`;
    return this.repo.save(item);
  }

  async list(query: { status?: string; page: number; pageSize: number }) {
    const qb = this.repo.createQueryBuilder("s");
    if (query.status) qb.andWhere("s.status = :status", { status: query.status });
    qb.orderBy("s.scheduledAt", "DESC");
    qb.skip((query.page - 1) * query.pageSize).take(query.pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  /** always-on 틱: scheduledAt이 지난 "scheduled" 건을 찾아 실제 발송한다. */
  private async processDue() {
    if (this.processing) return;
    this.processing = true;
    try {
      const due = await this.repo.find({
        where: { status: "scheduled", scheduledAt: LessThanOrEqual(new Date()) },
        order: { scheduledAt: "ASC" },
        take: 20,
      });
      for (const item of due) {
        await this.processOne(item);
      }
    } catch (err) {
      this.logger.error(`예약 발송 처리 실패: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.processing = false;
    }
  }

  private async processOne(item: KakaoScheduledDispatch) {
    try {
      if (item.kind === "test") {
        const variables = JSON.parse(item.variablesJson) as Record<string, string>;
        const result = await this.solapi.sendAlimtalk({
          toPhone: item.testPhone,
          variables,
          templateCode: item.templateCode,
        });
        item.status = result.ok ? "sent" : "failed";
        item.successCount = result.ok ? 1 : 0;
        item.failedCount = result.ok ? 0 : 1;
        item.errorMessage = result.errorMessage ?? null;
      } else {
        const leadIds = JSON.parse(item.leadIdsJson) as string[];
        const result = await this.kakaoNotifyService.dispatchBulk({
          leadIds,
          templateCode: item.templateCode,
          variables: JSON.parse(item.variablesJson) as Record<string, string>,
          templateNameVar: item.templateNameVar,
          adminUsername: item.createdByAdmin,
        });
        item.status = "sent";
        item.successCount = result.success;
        item.failedCount = result.failed;
      }
    } catch (err) {
      item.status = "failed";
      item.errorMessage = err instanceof Error ? err.message : "알 수 없는 오류";
      void this.telegramAlert.send(
        `⚠️ 예약 발송(${item.id})이 실패했습니다.\n오류: ${item.errorMessage}`,
      );
    } finally {
      item.processedAt = new Date();
      await this.repo.save(item);
    }
  }
}
