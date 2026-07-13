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

    lead.utmSource = visit.utmSource;
    lead.utmCampaign = visit.utmCampaign;
    lead.utmMedium = visit.utmMedium;
    await this.leadRepo.save(lead);

    visit.matched = true;
    await this.visitRepo.save(visit);

    this.logger.log(
      `리드 유입 매칭: ${lead.name || lead.phone} ← ${visit.utmSource}/${visit.utmCampaign} (visitId=${visit.visitId})`,
    );
  }
}
