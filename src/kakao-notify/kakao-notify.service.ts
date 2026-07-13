import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { KakaoLead, KakaoLeadSource } from "./kakao-lead.entity";
import { KakaoDispatchLog, KakaoDispatchTrigger } from "./kakao-dispatch-log.entity";
import { SolapiService } from "./solapi.service";
import { KakaoNotifySettingService } from "./kakao-notify-setting.service";
import { normalizePhone } from "./phone.util";
import { TelegramAlertService } from "./telegram-alert.service";
import { KakaoLandingVisit } from "./kakao-landing-visit.entity";

/** 연속으로 이 횟수만큼 발송이 실패하면 솔라피 자체 장애로 보고 텔레그램으로 알린다. */
const DISPATCH_FAILURE_ALERT_THRESHOLD = 3;

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
    @InjectRepository(KakaoLandingVisit)
    private readonly landingVisitRepo: Repository<KakaoLandingVisit>,
    private readonly solapi: SolapiService,
    private readonly settingService: KakaoNotifySettingService,
    private readonly telegramAlert: TelegramAlertService,
  ) {}

  private consecutiveDispatchFailures = 0;

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
    options: {
      triggeredBy: KakaoDispatchTrigger;
      triggeredByAdmin?: string;
      /** 지정하면 저장된 기본 템플릿 설정 대신 이 템플릿/변수로 발송한다(일괄발송용). */
      override?: { templateCode: string; variables: Record<string, string>; templateNameVar?: string };
    } = {
      triggeredBy: "auto",
    },
  ): Promise<KakaoDispatchLog> {
    const prevAttempts = await this.logRepo.count({ where: { leadId: lead.id } });

    const { templateCode, variables } = options.override
      ? {
          templateCode: options.override.templateCode,
          variables: this.settingService.resolveVariablesFor(
            lead,
            options.override.variables,
            options.override.templateNameVar || "회원명",
          ),
        }
      : await this.settingService.resolveVariables(lead);
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

    if (result.ok) {
      this.consecutiveDispatchFailures = 0;
    } else {
      this.consecutiveDispatchFailures += 1;
      if (this.consecutiveDispatchFailures === DISPATCH_FAILURE_ALERT_THRESHOLD) {
        void this.telegramAlert.send(
          `⚠️ 알림톡 발송이 ${this.consecutiveDispatchFailures}회 연속 실패했습니다.\n` +
            `최근 오류: ${result.errorMessage ?? "알 수 없는 오류"}\n` +
            `솔라피 연동 상태를 확인해 주세요.`,
        );
      }
    }

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

  /**
   * 관리자가 목록에서 선택한 리드들에게 지정한 템플릿으로 일괄 발송한다.
   * 각 건은 dispatchToLead와 동일하게 개별 발송 로그(triggeredBy:
   * "bulk_manual")를 남기며, 한 건 실패해도 나머지는 계속 진행한다.
   */
  async dispatchBulk(input: {
    leadIds: string[];
    templateCode: string;
    variables: Record<string, string>;
    templateNameVar?: string;
    adminUsername: string;
  }): Promise<{ total: number; success: number; failed: number; excluded: number }> {
    const leads = await this.leadRepo.find({ where: { id: In(input.leadIds) } });
    const targetLeads = leads.filter((l) => !l.excludedFromBulk);
    const excluded = leads.length - targetLeads.length;
    let success = 0;
    let failed = 0;
    for (const lead of targetLeads) {
      const log = await this.dispatchToLead(lead, {
        triggeredBy: "bulk_manual",
        triggeredByAdmin: input.adminUsername,
        override: {
          templateCode: input.templateCode,
          variables: input.variables,
          templateNameVar: input.templateNameVar,
        },
      });
      if (log.result === "success") success += 1;
      else failed += 1;
    }
    return { total: targetLeads.length, success, failed, excluded };
  }

  /** 필터 조건에 맞는 전체 리드의 ID만 조회한다(목록 "전체선택"용, 페이징 없음).
   *  "알림톡 제외" 처리된 리드는 선택 발송 대상이 아니므로 기본적으로 제외한다. */
  async findLeadIds(query: {
    source?: KakaoLeadSource;
    status?: string;
    search?: string;
    group?: string;
    joinedFrom?: string;
    joinedTo?: string;
    duplicateOnly?: boolean;
    includeExcluded?: boolean;
  }): Promise<string[]> {
    const qb = this.leadRepo.createQueryBuilder("lead").select("lead.id", "id");
    this.applyLeadFilters(qb, query);
    if (!query.includeExcluded) {
      qb.andWhere("lead.excludedFromBulk = :excluded", { excluded: false });
    }
    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  /** 관리자가 목록에서 개별 리드를 "알림톡 제외" ON/OFF 토글한다(선택 발송 대상에서만 제외). */
  async setBulkExclusion(id: string, excluded: boolean): Promise<KakaoLead> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException("고객 정보를 찾을 수 없습니다.");
    lead.excludedFromBulk = excluded;
    return this.leadRepo.save(lead);
  }

  /** 관리자가 목록에서 개별 리드에 그룹명(예: "2월 세미나")을 지정한다. */
  async setGroupLabel(id: string, groupLabel: string): Promise<KakaoLead> {
    const lead = await this.leadRepo.findOne({ where: { id } });
    if (!lead) throw new NotFoundException("고객 정보를 찾을 수 없습니다.");
    lead.groupLabel = groupLabel.trim();
    return this.leadRepo.save(lead);
  }

  /** 선택한 리드들에 한 번에 그룹명을 지정한다(대량 그룹핑용). */
  async setGroupLabelBulk(ids: string[], groupLabel: string): Promise<{ updated: number }> {
    if (ids.length === 0) return { updated: 0 };
    const result = await this.leadRepo
      .createQueryBuilder()
      .update(KakaoLead)
      .set({ groupLabel: groupLabel.trim() })
      .where("id IN (:...ids)", { ids })
      .execute();
    return { updated: result.affected ?? 0 };
  }

  /** 현재 사용 중인 그룹명 목록(중복 제거, 빈 값 제외)을 반환한다(필터 드롭다운용). */
  async findGroupLabels(): Promise<string[]> {
    const rows = await this.leadRepo
      .createQueryBuilder("lead")
      .select("DISTINCT lead.groupLabel", "groupLabel")
      .where("lead.groupLabel != :empty", { empty: "" })
      .orderBy("lead.groupLabel", "ASC")
      .getRawMany<{ groupLabel: string }>();
    return rows.map((r) => r.groupLabel);
  }

  private applyLeadFilters(
    qb: ReturnType<Repository<KakaoLead>["createQueryBuilder"]>,
    query: {
      source?: KakaoLeadSource;
      status?: string;
      search?: string;
      group?: string;
      joinedFrom?: string;
      joinedTo?: string;
      duplicateOnly?: boolean;
    },
  ): void {
    if (query.source) qb.andWhere("lead.source = :source", { source: query.source });
    if (query.status) qb.andWhere("lead.status = :status", { status: query.status });
    if (query.search) {
      qb.andWhere("(lead.name LIKE :search OR lead.phone LIKE :search)", {
        search: `%${query.search}%`,
      });
    }
    if (query.group) qb.andWhere("lead.groupLabel = :group", { group: query.group });
    // 같은 전화번호로 2건 이상(다른 유입경로/재신청 포함) 존재하는 리드만 필터링한다.
    if (query.duplicateOnly) {
      qb.andWhere(
        `lead.phone IN (SELECT phone FROM kakao_leads GROUP BY phone HAVING COUNT(*) > 1)`,
      );
    }
    // joinedFrom/joinedTo는 KST 기준 날짜(YYYY-MM-DD) 문자열로 받는다(목록의 가입시각 KST
    // 표시와 동일 기준). DB에는 UTC로 저장되어 있으므로 KST 자정을 UTC로 환산해 비교한다.
    if (query.joinedFrom) {
      const fromUtc = new Date(`${query.joinedFrom}T00:00:00+09:00`);
      qb.andWhere("lead.joinedAt >= :joinedFrom", { joinedFrom: fromUtc.toISOString() });
    }
    if (query.joinedTo) {
      const toUtc = new Date(`${query.joinedTo}T23:59:59.999+09:00`);
      qb.andWhere("lead.joinedAt <= :joinedTo", { joinedTo: toUtc.toISOString() });
    }
  }

  /** 일자별 신규 가입 건수를 소스별로 집계한다(대시보드 그래프용, KST 기준 실제 가입일).
   *  from/to를 생략하면 오늘로부터 최근 days일을 기본값으로 사용한다. */
  async getDailyStats(options: { days?: number; from?: string; to?: string }): Promise<
    Array<{ date: string; imweb: number; instagram: number; total: number }>
  > {
    // 서버(Railway)는 UTC로 돌아가므로 new Date()의 로컬 시간대에 의존하지 않고, KST
    // 기준 "오늘" 날짜를 직접 문자열로 계산한다(목록 화면의 가입시각 표시와 동일 기준).
    const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayKstStr = nowKst.toISOString().slice(0, 10);

    let sinceKstStr: string;
    let untilKstStr: string;
    if (options.from && options.to) {
      sinceKstStr = options.from;
      untilKstStr = options.to;
    } else {
      const days = options.days ?? 14;
      const sinceDate = new Date(`${todayKstStr}T00:00:00Z`);
      sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
      sinceKstStr = sinceDate.toISOString().slice(0, 10);
      untilKstStr = todayKstStr;
    }
    const totalDays =
      Math.round(
        (new Date(`${untilKstStr}T00:00:00Z`).getTime() -
          new Date(`${sinceKstStr}T00:00:00Z`).getTime()) /
          86_400_000,
      ) + 1;
    if (totalDays < 1 || totalDays > 366) {
      throw new BadRequestException("조회 기간이 올바르지 않습니다.");
    }

    // 실제 가입/신청일(joinedAt) 기준으로 집계한다. 이관·백필 등으로 수집시각(createdAt)이
    // 실제 가입일과 크게 어긋나는 경우가 있어, "그 날짜에 유입된 DB"를 정확히 보여주려면
    // joinedAt을 우선 사용해야 한다(없으면 createdAt으로 대체). DB에는 UTC로 저장되어
    // 있으므로, 목록 화면(KST 표시)과 동일한 날짜가 나오도록 KST로 변환한 뒤 날짜를 뽑는다.
    const isPostgres = this.leadRepo.manager.connection.options.type === "postgres";
    const dateExpr = isPostgres
      ? "COALESCE(DATE(lead.joinedAt AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'), DATE(lead.createdAt AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'))"
      : "COALESCE(DATE(lead.joinedAt, '+9 hours'), DATE(lead.createdAt, '+9 hours'))";
    const rows = await this.leadRepo
      .createQueryBuilder("lead")
      .select(dateExpr, "date")
      .addSelect("lead.source", "source")
      .addSelect("COUNT(*)", "count")
      .where(`${dateExpr} >= :since`, { since: sinceKstStr })
      .andWhere(`${dateExpr} <= :until`, { until: untilKstStr })
      .groupBy(dateExpr)
      .addGroupBy("lead.source")
      .orderBy(dateExpr, "ASC")
      .getRawMany<{ date: string | Date; source: KakaoLeadSource; count: string }>();

    const byDate = new Map<string, { imweb: number; instagram: number }>();
    for (const row of rows) {
      // Postgres는 DATE()가 Date 객체로, sql.js(SQLite)는 문자열로 온다.
      const dateKey =
        row.date instanceof Date
          ? row.date.toISOString().slice(0, 10)
          : String(row.date).slice(0, 10);
      const entry = byDate.get(dateKey) ?? { imweb: 0, instagram: 0 };
      entry[row.source] = Number(row.count);
      byDate.set(dateKey, entry);
    }

    const result: Array<{ date: string; imweb: number; instagram: number; total: number }> = [];
    for (let i = 0; i < totalDays; i += 1) {
      const d = new Date(`${sinceKstStr}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      const dateKey = d.toISOString().slice(0, 10);
      const entry = byDate.get(dateKey) ?? { imweb: 0, instagram: 0 };
      result.push({ date: dateKey, ...entry, total: entry.imweb + entry.instagram });
    }
    return result;
  }

  async findLeads(query: {
    source?: KakaoLeadSource;
    status?: string;
    search?: string;
    group?: string;
    joinedFrom?: string;
    joinedTo?: string;
    duplicateOnly?: boolean;
    page: number;
    pageSize: number;
  }) {
    const qb = this.leadRepo.createQueryBuilder("lead");
    this.applyLeadFilters(qb, query);
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
    const landingVisit = lead.visitId
      ? await this.landingVisitRepo.findOne({ where: { visitId: lead.visitId } })
      : null;
    return {
      lead,
      logs,
      otherApplications: otherApplications.filter((l) => l.id !== lead.id),
      landingVisit,
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
