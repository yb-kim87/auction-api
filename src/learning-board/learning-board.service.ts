import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionAssignment, ServiceReport } from "./learning-board.entity";

@Injectable()
export class LearningBoardService {
  constructor(@InjectRepository(AuctionAssignment) private readonly assignments: Repository<AuctionAssignment>, @InjectRepository(ServiceReport) private readonly reports: Repository<ServiceReport>) {}
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
    return this.assignments.save(row);
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
    if (body.coachFeedback !== undefined) row.coachFeedback = body.coachFeedback;
    if (body.status !== undefined) row.status = body.status;
    return this.assignments.save(row);
  }
}
