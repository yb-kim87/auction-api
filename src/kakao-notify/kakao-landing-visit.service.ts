import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KakaoLandingVisit } from "./kakao-landing-visit.entity";
import { KakaoLead } from "./kakao-lead.entity";

/** signupConfirmedAt과 아임웹 join_time의 매칭을 허용하는 최대 시간 간격(분).
 *  같은 visitId 기준이라 넓게 잡아도 다른 사람과 섞이지 않는다. */
const MATCH_WINDOW_MINUTES = 30;

@Injectable()
export class KakaoLandingVisitService {
  private readonly logger = new Logger(KakaoLandingVisitService.name);

  constructor(
    @InjectRepository(KakaoLandingVisit)
    private readonly visitRepo: Repository<KakaoLandingVisit>,
    @InjectRepository(KakaoLead)
    private readonly leadRepo: Repository<KakaoLead>,
  ) {}

  /** 랜딩페이지 방문 시 고유 visitId를 발급하고 UTM/리퍼러 정보를 기록한다. */
  async recordVisit(input: {
    visitId?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmContent?: string;
    fbclid?: string;
    landingUrl?: string;
    referrer?: string;
  }): Promise<{ ok: boolean }> {
    if (!input.visitId?.trim()) {
      throw new BadRequestException("visitId가 필요합니다.");
    }

    const existing = await this.visitRepo.findOne({ where: { visitId: input.visitId.trim() } });
    if (existing) return { ok: true };

    await this.visitRepo.save(
      this.visitRepo.create({
        visitId: input.visitId.trim(),
        utmSource: input.utmSource?.trim() ?? "",
        utmMedium: input.utmMedium?.trim() ?? "",
        utmCampaign: input.utmCampaign?.trim() ?? "",
        utmContent: input.utmContent?.trim() ?? "",
        fbclid: input.fbclid?.trim() ?? "",
        landingUrl: input.landingUrl?.trim() ?? "",
        referrer: input.referrer?.trim() ?? "",
        visitedAt: new Date(),
      }),
    );
    return { ok: true };
  }

  /** 가입완료 페이지에서 "이 visitId가 방금 가입을 완료했다"는 신호를 기록한다. */
  async confirmSignup(visitId: string): Promise<{ ok: boolean }> {
    if (!visitId?.trim()) throw new BadRequestException("visitId가 필요합니다.");
    const visit = await this.visitRepo.findOne({ where: { visitId: visitId.trim() } });
    if (!visit) return { ok: false };
    visit.signupConfirmedAt = new Date();
    await this.visitRepo.save(visit);
    return { ok: true };
  }

  /**
   * 가입완료 페이지의 "카톡방 참여하기" 버튼 클릭을 기록한다. 클릭 여부만
   * 확인 가능하고, 실제 오픈채팅 입장 여부는 카카오 쪽 API 미공개로 확인할
   * 수 없다. 이미 리드로 매칭된 방문(visitId가 리드에 저장됨)이면 리드에도
   * 바로 반영하고, 아직 매칭 전이면 방문 기록에만 남겨뒀다가
   * matchLeadToVisit에서 함께 옮긴다.
   */
  async recordKakaoRoomClick(visitId: string): Promise<{ ok: boolean }> {
    if (!visitId?.trim()) throw new BadRequestException("visitId가 필요합니다.");
    const visit = await this.visitRepo.findOne({ where: { visitId: visitId.trim() } });
    if (!visit) return { ok: false };

    const clickedAt = new Date();
    visit.kakaoRoomClickedAt = clickedAt;
    await this.visitRepo.save(visit);

    const lead = await this.leadRepo.findOne({ where: { visitId: visit.visitId } });
    if (lead) {
      lead.kakaoRoomClickedAt = clickedAt;
      await this.leadRepo.save(lead);
    }
    return { ok: true };
  }

  /**
   * 신규 리드의 가입시각(joinedAt) 기준으로, 가입완료 신호가 온 시각이 가장
   * 가까운 미매칭 방문 기록을 찾아 유입 정보를 채운다.
   */
  async matchLeadToVisit(lead: KakaoLead): Promise<void> {
    if (!lead.joinedAt) return;
    const windowMs = MATCH_WINDOW_MINUTES * 60_000;
    const from = new Date(lead.joinedAt.getTime() - windowMs);
    const to = new Date(lead.joinedAt.getTime() + windowMs);

    // joinedAt과 가장 가까운 signupConfirmedAt을 찾는다. 정렬식은 DB마다 문법이
    // 달라(Postgres: EXTRACT(EPOCH...), SQLite: julianday) 후보를 모두 가져온
    // 뒤 애플리케이션에서 가장 가까운 것을 고르는 방식으로 통일한다.
    const candidates = await this.visitRepo
      .createQueryBuilder("v")
      .where("v.matched = false")
      .andWhere("v.signupConfirmedAt IS NOT NULL")
      .andWhere("v.signupConfirmedAt >= :from", { from })
      .andWhere("v.signupConfirmedAt <= :to", { to })
      .getMany();

    if (candidates.length === 0) return;
    const joinedAtMs = lead.joinedAt.getTime();
    const visit = candidates.reduce((closest, cur) =>
      Math.abs((cur.signupConfirmedAt?.getTime() ?? 0) - joinedAtMs) <
      Math.abs((closest.signupConfirmedAt?.getTime() ?? 0) - joinedAtMs)
        ? cur
        : closest,
    );

    // 가입완료 신호를 보낸 방문(visit)의 UTM이 비어있으면, 같은 광고 클릭이
    // 페이지 이동 중 다른 visitId로 다시 기록된 경우일 수 있다(예: 아임웹
    // 랜딩 페이지→가입 페이지 전환 시 저장 타이밍 문제). 이 경우 같은 시간창
    // 안에서 UTM이 있는 다른 미매칭 방문을 찾아 UTM만 보강한다(visitId·클릭
    // 추적은 실제 가입완료 신호를 보낸 visit 기준을 그대로 유지).
    let utmSource = visit.utmSource;
    let utmCampaign = visit.utmCampaign;
    let utmMedium = visit.utmMedium;
    let utmContent = visit.utmContent;
    if (!utmSource && !utmCampaign) {
      const utmFallback = await this.visitRepo
        .createQueryBuilder("v")
        .where("v.matched = false")
        .andWhere("v.id != :excludeId", { excludeId: visit.id })
        .andWhere("(v.utmSource != '' OR v.utmCampaign != '')")
        .andWhere("v.visitedAt >= :from", { from })
        .andWhere("v.visitedAt <= :to", { to })
        .orderBy("v.visitedAt", "DESC")
        .getOne();
      if (utmFallback) {
        utmSource = utmFallback.utmSource;
        utmCampaign = utmFallback.utmCampaign;
        utmMedium = utmFallback.utmMedium;
        utmContent = utmFallback.utmContent;
        utmFallback.matched = true;
        await this.visitRepo.save(utmFallback);
      }
    }

    lead.utmSource = utmSource;
    lead.utmCampaign = utmCampaign;
    lead.utmMedium = utmMedium;
    lead.utmContent = utmContent;
    lead.visitId = visit.visitId;
    if (visit.kakaoRoomClickedAt) lead.kakaoRoomClickedAt = visit.kakaoRoomClickedAt;
    await this.leadRepo.save(lead);

    visit.matched = true;
    await this.visitRepo.save(visit);

    this.logger.log(
      `리드 유입 매칭: ${lead.name || lead.phone} ← ${utmSource}/${utmCampaign} (visitId=${visit.visitId})`,
    );
  }

  /**
   * 이미 visitId로 매칭됐지만 utmContent(소재ID) 필드가 추가되기 전에
   * 처리되어 값이 비어있는 기존 리드를 원본 방문 기록 기준으로 채운다.
   * 1회성 백필용.
   */
  async backfillUtmContent(): Promise<{ checked: number; updated: number }> {
    const leads = await this.leadRepo
      .createQueryBuilder("l")
      .where("l.visitId != ''")
      .andWhere("l.utmContent = ''")
      .getMany();

    let updated = 0;
    for (const lead of leads) {
      const visit = await this.visitRepo.findOne({ where: { visitId: lead.visitId } });
      if (!visit?.utmContent) continue;
      lead.utmContent = visit.utmContent;
      await this.leadRepo.save(lead);
      updated += 1;
    }
    return { checked: leads.length, updated };
  }
}
