import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KakaoLead, KakaoLeadSource } from "./kakao-lead.entity";
import { KakaoDispatchLog, KakaoDispatchTrigger } from "./kakao-dispatch-log.entity";
import { SolapiService } from "./solapi.service";
import { KakaoNotifySettingService } from "./kakao-notify-setting.service";
import { normalizePhone } from "./phone.util";

export type IngestResult =
  | { outcome: "created"; lead: KakaoLead }
  | { outcome: "resubmitted"; lead: KakaoLead }
  | { outcome: "duplicate"; lead: KakaoLead }
  | { outcome: "invalid_phone" };

@Injectable()
export class KakaoNotifyService {
  constructor(
    @InjectRepository(KakaoLead)
    private readonly leadRepo: Repository<KakaoLead>,
    @InjectRepository(KakaoDispatchLog)
    private readonly logRepo: Repository<KakaoDispatchLog>,
    private readonly solapi: SolapiService,
    private readonly settingService: KakaoNotifySettingService,
  ) {}

  /**
   * 리드 upsert. 같은 (source, sourceRefId)는 이미 처리한 원본 행을 다시
   * 읽은 것이므로 duplicate로 무시한다(재실행 시 무한 재발송 방지). 같은
   * (source, phone)이지만 sourceRefId가 다르면 "재신청"으로 보고 기존
   * 리드 정보를 최신화한 뒤 resubmitted로 반환해 재발송 대상이 되게 한다.
   * 다른 source의 phone은 별도 신규 리드로 등록한다.
   */
  async ingestLead(input: {
    source: KakaoLeadSource;
    sourceRefId: string;
    name: string;
    rawPhone: string;
    email?: string;
    gender?: string;
    birthDate?: string;
    address?: string;
    adName?: string;
    joinedAt?: Date | null;
    rawPayload: unknown;
  }): Promise<IngestResult> {
    const phone = normalizePhone(input.rawPhone);
    if (!phone) return { outcome: "invalid_phone" };

    const sameRef = await this.leadRepo.findOne({
      where: { source: input.source, sourceRefId: input.sourceRefId },
    });
    if (sameRef) return { outcome: "duplicate", lead: sameRef };

    const samePhone = await this.leadRepo.findOne({
      where: { source: input.source, phone },
    });
    if (samePhone) {
      samePhone.sourceRefId = input.sourceRefId;
      samePhone.name = input.name.trim();
      samePhone.email = input.email?.trim() ?? "";
      samePhone.gender = input.gender?.trim() ?? "";
      samePhone.birthDate = input.birthDate?.trim() ?? "";
      samePhone.address = input.address?.trim() ?? "";
      samePhone.adName = input.adName?.trim() ?? "";
      samePhone.joinedAt = input.joinedAt ?? samePhone.joinedAt;
      samePhone.rawPayload = JSON.stringify(input.rawPayload ?? {});
      samePhone.status = "pending";
      const updated = await this.leadRepo.save(samePhone);
      return { outcome: "resubmitted", lead: updated };
    }

    try {
      const lead = await this.leadRepo.save(
        this.leadRepo.create({
          source: input.source,
          sourceRefId: input.sourceRefId,
          name: input.name.trim(),
          phone,
          email: input.email?.trim() ?? "",
          gender: input.gender?.trim() ?? "",
          birthDate: input.birthDate?.trim() ?? "",
          address: input.address?.trim() ?? "",
          adName: input.adName?.trim() ?? "",
          joinedAt: input.joinedAt ?? null,
          rawPayload: JSON.stringify(input.rawPayload ?? {}),
          status: "pending",
        }),
      );
      return { outcome: "created", lead };
    } catch {
      // 동시 upsert로 유니크 제약이 뒤늦게 걸린 경우(레이스 컨디션) 재조회
      const raced = await this.leadRepo.findOne({
        where: [
          { source: input.source, sourceRefId: input.sourceRefId },
          { source: input.source, phone },
        ],
      });
      if (raced) return { outcome: "duplicate", lead: raced };
      throw new BadRequestException("리드 저장에 실패했습니다.");
    }
  }

  /** 리드에 알림톡 발송 시도 + 로그 기록 + 리드 상태 갱신 */
  async dispatchToLead(
    lead: KakaoLead,
    options: { triggeredBy: KakaoDispatchTrigger; triggeredByAdmin?: string } = {
      triggeredBy: "auto",
    },
  ): Promise<KakaoDispatchLog> {
    const prevAttempts = await this.logRepo.count({ where: { leadId: lead.id } });

    const { templateCode, variables } = await this.settingService.resolveVariables(lead);
    const result = await this.solapi.sendAlimtalk({
      toPhone: lead.phone,
      variables,
      templateCode,
    });

    const log = await this.logRepo.save(
      this.logRepo.create({
        leadId: lead.id,
        attemptNo: prevAttempts + 1,
        templateCode,
        requestPayload: JSON.stringify({ toPhone: lead.phone, variables }),
        responsePayload: JSON.stringify(result.responseBody ?? {}),
        result: result.ok ? "success" : "failed",
        errorMessage: result.errorMessage ?? null,
        triggeredBy: options.triggeredBy,
        triggeredByAdmin: options.triggeredByAdmin ?? null,
      }),
    );

    lead.status = result.ok ? "sent" : "failed";
    await this.leadRepo.save(lead);

    return log;
  }

  /** 신규 리드 저장 직후 자동 발송(동기화 스케줄러에서 호출) */
  async ingestAndDispatch(input: {
    source: KakaoLeadSource;
    sourceRefId: string;
    name: string;
    rawPhone: string;
    email?: string;
    gender?: string;
    birthDate?: string;
    address?: string;
    adName?: string;
    joinedAt?: Date | null;
    rawPayload: unknown;
  }): Promise<IngestResult> {
    const result = await this.ingestLead(input);
    if (result.outcome === "created" || result.outcome === "resubmitted") {
      await this.dispatchToLead(result.lead, { triggeredBy: "auto" });
    }
    return result;
  }

  /**
   * 이미 다른 경로(Make 등)로 알림톡을 발송한 기존 고객을 데이터만
   * 채워넣기 위한 백필 전용 메서드. 실제 발송은 하지 않고 리드를
   * 저장한 뒤 상태를 곧바로 sent로 표시한다(발송 로그는 남기지 않음).
   */
  async backfillLeadAsSent(input: {
    source: KakaoLeadSource;
    sourceRefId: string;
    name: string;
    rawPhone: string;
    email?: string;
    gender?: string;
    birthDate?: string;
    address?: string;
    adName?: string;
    joinedAt?: Date | null;
    rawPayload: unknown;
  }): Promise<IngestResult> {
    const result = await this.ingestLead(input);
    if (result.outcome === "created" || result.outcome === "resubmitted") {
      result.lead.status = "sent";
      await this.leadRepo.save(result.lead);
    }
    return result;
  }

  /** 특정 유입경로의 리드를 전량 삭제한다(백필 순서 재작업 등 1회성 정리용). */
  async deleteLeadsBySource(source: KakaoLeadSource): Promise<{ deleted: number }> {
    const result = await this.leadRepo.delete({ source });
    return { deleted: result.affected ?? 0 };
  }

  /** 관리자 화면에서 선택한 리드들을 일괄 삭제한다(발송 이력도 함께 삭제). */
  async deleteLeadsByIds(ids: string[]): Promise<{ deleted: number }> {
    if (ids.length === 0) return { deleted: 0 };
    await this.logRepo
      .createQueryBuilder()
      .delete()
      .where("leadId IN (:...ids)", { ids })
      .execute();
    const result = await this.leadRepo
      .createQueryBuilder()
      .delete()
      .where("id IN (:...ids)", { ids })
      .execute();
    return { deleted: result.affected ?? 0 };
  }

  async findLeads(query: {
    source?: KakaoLeadSource;
    status?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    const qb = this.leadRepo.createQueryBuilder("lead");
    if (query.source) qb.andWhere("lead.source = :source", { source: query.source });
    if (query.status) qb.andWhere("lead.status = :status", { status: query.status });
    if (query.search) {
      qb.andWhere("(lead.name LIKE :search OR lead.phone LIKE :search)", {
        search: `%${query.search}%`,
      });
    }
    qb.orderBy("CASE WHEN lead.joinedAt IS NULL THEN 1 ELSE 0 END", "ASC");
    qb.addOrderBy("lead.joinedAt", "DESC");
    qb.addOrderBy("lead.createdAt", "DESC");
    qb.skip((query.page - 1) * query.pageSize).take(query.pageSize);

    const [items, total] = await qb.getManyAndCount();

    // 같은 전화번호로 다른 유입경로/재신청 이력이 있는지 목록에서도 바로 보이게
    // 표시하기 위해, 현재 페이지에 있는 전화번호들의 전체 리드 개수를 함께 조회한다.
    const phones = [...new Set(items.map((l) => l.phone))];
    const duplicateCountMap = new Map<string, number>();
    if (phones.length > 0) {
      const counts = await this.leadRepo
        .createQueryBuilder("lead")
        .select("lead.phone", "phone")
        .addSelect("COUNT(*)", "count")
        .where("lead.phone IN (:...phones)", { phones })
        .groupBy("lead.phone")
        .getRawMany<{ phone: string; count: string }>();
      for (const row of counts) {
        duplicateCountMap.set(row.phone, Number(row.count));
      }
    }
    const itemsWithDuplicateInfo = items.map((lead) => ({
      ...lead,
      hasDuplicateApplications: (duplicateCountMap.get(lead.phone) ?? 1) > 1,
    }));

    return { items: itemsWithDuplicateInfo, total, page: query.page, pageSize: query.pageSize };
  }

  async getLeadWithLogs(id: string) {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException("고객 정보를 찾을 수 없습니다.");
    const logs = await this.logRepo.find({
      where: { leadId: id },
      order: { sentAt: "DESC" },
    });
    // 같은 전화번호로 다른 유입경로에서도 신청한 이력이 있는지(재신청) 함께 보여준다.
    const otherApplications = await this.leadRepo.find({
      where: { phone: lead.phone },
      order: { createdAt: "DESC" },
    });
    return {
      lead,
      logs,
      otherApplications: otherApplications.filter((l) => l.id !== lead.id),
    };
  }

  async resendToLead(id: string, adminUsername: string) {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException("고객 정보를 찾을 수 없습니다.");
    return this.dispatchToLead(lead, {
      triggeredBy: "manual_retry",
      triggeredByAdmin: adminUsername,
    });
  }

  /** 관리자 단건 테스트 발송. 리드를 생성하지 않고 솔라피만 호출한다. */
  async testSend(input: {
    name: string;
    rawPhone: string;
    adminUsername: string;
    templateCode?: string;
    variables?: Record<string, string>;
  }) {
    const phone = normalizePhone(input.rawPhone);
    if (!phone) {
      throw new BadRequestException("전화번호 형식을 확인해 주세요. (예: 010-1234-5678)");
    }

    let templateCode = input.templateCode?.trim() ?? "";
    let variables = input.variables;

    if (!templateCode) {
      const resolved = await this.settingService.resolveVariables({ name: input.name });
      templateCode = resolved.templateCode;
      variables = variables ?? resolved.variables;
    }

    if (!variables || Object.keys(variables).length === 0) {
      variables = { 회원명: input.name.trim() || "고객" };
    }

    const result = await this.solapi.sendAlimtalk({ toPhone: phone, variables, templateCode });

    const log = await this.logRepo.save(
      this.logRepo.create({
        leadId: null,
        attemptNo: 1,
        templateCode,
        requestPayload: JSON.stringify({ toPhone: phone, variables }),
        responsePayload: JSON.stringify(result.responseBody ?? {}),
        result: result.ok ? "success" : "failed",
        errorMessage: result.errorMessage ?? null,
        triggeredBy: "test",
        triggeredByAdmin: input.adminUsername,
      }),
    );

    return log;
  }

  async findDispatchLogs(query: {
    result?: string;
    page: number;
    pageSize: number;
  }) {
    const qb = this.logRepo.createQueryBuilder("log");
    if (query.result) qb.andWhere("log.result = :result", { result: query.result });
    qb.orderBy("log.sentAt", "DESC");
    qb.skip((query.page - 1) * query.pageSize).take(query.pageSize);

    const [items, total] = await qb.getManyAndCount();
    return { items, total, page: query.page, pageSize: query.pageSize };
  }
}
