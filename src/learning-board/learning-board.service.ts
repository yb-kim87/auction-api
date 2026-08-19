import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionAssignment, ServiceReport } from "./learning-board.entity";
import { SolapiService } from "../kakao-notify/solapi.service";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";
import { UsersService } from "../users/users.service";
import { SiteSettingsService } from "../site-settings/site-settings.service";

@Injectable()
export class LearningBoardService {
  private readonly logger = new Logger(LearningBoardService.name);

  constructor(
    @InjectRepository(AuctionAssignment) private readonly assignments: Repository<AuctionAssignment>,
    @InjectRepository(ServiceReport) private readonly reports: Repository<ServiceReport>,
    private readonly solapi: SolapiService,
    private readonly telegramAlert: TelegramAlertService,
    private readonly usersService: UsersService,
    private readonly siteSettings: SiteSettingsService,
  ) {}
  listAssignments(username: string) { return this.assignments.find({ where: { username }, order: { updatedAt: "DESC" } }); }
  findAssignmentByAuction(username: string, auctionId: string) { return this.assignments.findOne({ where: { username, auctionId } }); }

  /** 물건 상세의 "과제제출" 버튼에서 호출 — 입찰계획 값(매도가/입찰가/
   * 수익/필요자기자본)과 과제 전용 항목(메모/전화시세/안전마진조사)을
   * 함께 저장한다. 같은 물건에 이미 제출한 과제가 있으면 새로 만들지
   * 않고 덮어쓴다(사용자 요청, 2026-08-07: "과제제출 방식을 바꾸고
   * 싶어... 입찰계획 내용이 같이 저장돼서 과제제출이 되면" — 재제출은
   * 수정으로 취급). */
  async saveAssignment(username: string, auctionId: string, body: Partial<AuctionAssignment>) {
    const existing = await this.assignments.findOne({ where: { username, auctionId } });
    const row = existing ?? this.assignments.create({ username, auctionId, status: "draft" });
    Object.assign(row, body, { username, auctionId });
    const saved = await this.assignments.save(row);
    if (!existing) {
      // 재제출(수정)이 아니라 최초 제출일 때만 코치에게 알린다. 알림
      // 발송 실패로 과제 제출 자체가 실패하면 안 되므로 절대 throw하지
      // 않는다(사용자 요청, 2026-08-15).
      void this.notifyCoachOfNewAssignment(saved).catch((err) =>
        this.logger.error(`과제 등록 알림 발송 실패: ${err instanceof Error ? err.message : err}`),
      );
    }
    return saved;
  }

  async updateAssignment(username: string, id: string, body: Partial<AuctionAssignment>) { const row = await this.assignments.findOneBy({ id, username }); if (!row) throw new ForbiddenException("과제를 찾을 수 없습니다."); Object.assign(row, body); return this.assignments.save(row); }
  async deleteAssignment(username: string, id: string) { const row = await this.assignments.findOneBy({ id, username }); if (!row) throw new ForbiddenException("과제를 찾을 수 없습니다."); await this.assignments.remove(row); return { ok: true }; }
  listReports(username: string) { return this.reports.find({ where: { username }, order: { createdAt: "DESC" } }); }
  createReport(username: string, body: Partial<ServiceReport>) { return this.reports.save(this.reports.create({ username, ...body, status: "received" })); }

  /** 코치(관리자)용 — 전체 수강생 과제 제출 목록(사용자 요청, 2026-08-07:
   * "코치(관리자는) 해당 제출된 내용을 볼 수 있으면 좋겠어"). 소유자
   * 제한 없이 전체를 최신순으로 반환한다. */
  listAllAssignmentsForCoach() { return this.assignments.find({ order: { updatedAt: "DESC" } }); }

  /** 코치(관리자)가 피드백/상태를 남긴다 — 제출자 본인이 아니어도
   * 수정할 수 있어야 하므로 updateAssignment(소유자 제한)와 별도 경로. */
  async coachUpdateAssignment(id: string, body: { coachFeedback?: string; status?: string }) {
    const row = await this.assignments.findOneBy({ id });
    if (!row) throw new ForbiddenException("과제를 찾을 수 없습니다.");
    const feedbackAdded = body.coachFeedback !== undefined && body.coachFeedback.trim() && body.coachFeedback !== row.coachFeedback;
    if (body.coachFeedback !== undefined) row.coachFeedback = body.coachFeedback;
    if (body.status !== undefined) row.status = body.status;
    const saved = await this.assignments.save(row);
    if (feedbackAdded) {
      void this.notifyStudentOfCoachFeedback(saved).catch((err) =>
        this.logger.error(`코치 피드백 알림 발송 실패: ${err instanceof Error ? err.message : err}`),
      );
    }
    return saved;
  }

  /** 과제 등록/코치 피드백 알림톡(사용자 요청, 2026-08-15) — "과제
   * 검토" 관리자 탭의 토글이 꺼져 있으면 아무것도 하지 않는다. 발신은
   * 기존 솔라피(경매코치) 계정을 그대로 쓰고, 템플릿 코드가 비어 있으면
   * (초기 상태) 승인 절차가 필요 없는 문자(SMS)로 대체 발송한다. */
  private async sendAssignmentNotify(toPhone: string, text: string, templateCode: string, variables: Record<string, string>) {
    const phone = toPhone.trim();
    if (!phone) return;
    if (templateCode.trim()) {
      await this.solapi.sendAlimtalk({ toPhone: phone, templateCode: templateCode.trim(), variables });
    } else {
      await this.solapi.sendSms({ toPhone: phone, text, subject: "코치픽 알림" });
    }
  }

  /** 코치(관리자) 알림 — 텔레그램은 "과제 알림 사용" 토글과 무관하게
   * 항상 보낸다(사용자 요청, 2026-08-19: "관리자만 텔레그램으로 하고
   * 싶은데" — 토글을 켜면 아래 카카오 알림톡/문자(수강생 피드백 알림
   * 포함)까지 함께 켜져 버리는 게 문제였음). 이미 보안 로그 알림에
   * 쓰고 있던 텔레그램 봇(`TelegramAlertService`, 별도 폰번호 등록
   * 불필요)을 그대로 재사용한다. 코치 폰번호를 등록하고 토글도 켜면
   * 카카오 알림톡/문자도 추가로 함께 간다(수강생 대상 알림과 같은 토글
   * — 아직 수강생 쪽엔 적용하지 않기로 해 기본 꺼짐 유지).
   */
  private async notifyCoachOfNewAssignment(assignment: AuctionAssignment) {
    const user = await this.usersService.findByUsername(assignment.username);
    const studentName = user?.name || assignment.username;
    const memoLine = assignment.memo.trim() ? `\n문의사항: ${assignment.memo.trim()}` : "";
    const text = `[코치픽] ${studentName}님이 새 과제를 제출했습니다.\n물건: ${assignment.auctionNo} ${assignment.address}${memoLine}\n관리자 페이지 > 과제 검토에서 확인해 주세요.`;
    await this.telegramAlert.send(text);

    const settings = await this.siteSettings.get();
    if (settings.assignmentNotifyEnabled && settings.assignmentNotifyCoachPhone.trim()) {
      await this.sendAssignmentNotify(settings.assignmentNotifyCoachPhone, text, settings.assignmentCreatedTemplateCode, {
        이름: studentName,
        사건번호: assignment.auctionNo,
        주소: assignment.address,
      });
    }
  }

  private async notifyStudentOfCoachFeedback(assignment: AuctionAssignment) {
    const settings = await this.siteSettings.get();
    if (!settings.assignmentNotifyEnabled) return;
    const user = await this.usersService.findByUsername(assignment.username);
    const phone = user?.phone?.trim();
    if (!phone) return;
    const text = `[코치픽] 제출하신 과제(${assignment.auctionNo})에 코치 피드백이 등록됐습니다.\n내 물건 > 과제제출에서 확인해 보세요.`;
    await this.sendAssignmentNotify(phone, text, settings.coachFeedbackTemplateCode, {
      사건번호: assignment.auctionNo,
      주소: assignment.address,
    });
  }
}
