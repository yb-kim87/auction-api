import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin, requireSearchAccess } from "../common/auth-context";
import { LearningBoardService } from "./learning-board.service";

@Controller("learning-board")
export class LearningBoardController {
  constructor(private readonly service: LearningBoardService) {}
  private user(headers: Record<string, string>) { const ctx = getAuthContext(headers); requireSearchAccess(ctx); return ctx.username; }
  @Get("assignments") listAssignments(@Headers() h: Record<string, string>) { return this.service.listAssignments(this.user(h)); }

  /** 물건 상세 "과제제출" 버튼이 이 물건에 이미 제출한 과제가 있는지
   * 확인할 때 사용(사용자 요청, 2026-08-07) — 있으면 폼을 채워 재제출 시
   * 수정으로 처리한다. */
  @Get("assignments/by-auction/:auctionId")
  getAssignmentByAuction(@Headers() h: Record<string, string>, @Param("auctionId") auctionId: string) {
    return this.service.findAssignmentByAuction(this.user(h), auctionId);
  }

  /** 코치(관리자) 전용 — 전체 제출 현황 조회. */
  @Get("assignments/coach")
  listAssignmentsForCoach(@Headers() h: Record<string, string>) {
    requireAdmin(getAuthContext(h));
    return this.service.listAllAssignmentsForCoach();
  }

  /** 코치(관리자) 전용 — 과제 검토 목록에서 물건번호를 눌러 그 물건의
   * 상세(수익계산기) 화면으로 이동했을 때, 특정 수강생이 제출한 과제를
   * 조회한다(사용자 요청, 2026-08-07: "과제 물건번호를 누르면
   * 입찰계획으로 넘어가고 거기에 수강생이 과제로 제출한 정보가
   * 보이게 하는건 어떨까?"). */
  @Get("assignments/coach/:username/:auctionId")
  getAssignmentForCoach(
    @Headers() h: Record<string, string>,
    @Param("username") username: string,
    @Param("auctionId") auctionId: string,
  ) {
    requireAdmin(getAuthContext(h));
    return this.service.findAssignmentByAuction(username, auctionId);
  }

  @Post("assignments")
  createAssignment(@Headers() h: Record<string, string>, @Body() b: Record<string, unknown>) {
    const auctionId = String(b.auctionId ?? "").trim();
    if (!auctionId) throw new BadRequestException("auctionId가 필요합니다.");
    return this.service.saveAssignment(this.user(h), auctionId, b as never);
  }

  @Patch("assignments/:id") updateAssignment(@Headers() h: Record<string, string>, @Param("id") id: string, @Body() b: Record<string, unknown>) { return this.service.updateAssignment(this.user(h), id, b as never); }

  /** 코치(관리자) 전용 — 피드백/상태 저장(제출자 소유 제한 없음). */
  @Patch("assignments/:id/coach")
  coachUpdateAssignment(
    @Headers() h: Record<string, string>,
    @Param("id") id: string,
    @Body() b: { coachFeedback?: string; status?: string },
  ) {
    requireAdmin(getAuthContext(h));
    return this.service.coachUpdateAssignment(id, b);
  }

  @Delete("assignments/:id") deleteAssignment(@Headers() h: Record<string, string>, @Param("id") id: string) { return this.service.deleteAssignment(this.user(h), id); }
  @Get("reports") listReports(@Headers() h: Record<string, string>) { return this.service.listReports(this.user(h)); }
  @Post("reports") createReport(@Headers() h: Record<string, string>, @Body() b: Record<string, unknown>) { return this.service.createReport(this.user(h), b as never); }
}
