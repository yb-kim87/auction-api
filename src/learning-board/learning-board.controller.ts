import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireSearchAccess } from "../common/auth-context";
import { LearningBoardService } from "./learning-board.service";

@Controller("learning-board")
export class LearningBoardController {
  constructor(private readonly service: LearningBoardService) {}
  private user(headers: Record<string, string>) { const ctx = getAuthContext(headers); requireSearchAccess(ctx); return ctx.username; }
  @Get("assignments") listAssignments(@Headers() h: Record<string, string>) { return this.service.listAssignments(this.user(h)); }
  @Post("assignments") createAssignment(@Headers() h: Record<string, string>, @Body() b: Record<string, unknown>) { return this.service.createAssignment(this.user(h), b as never); }
  @Patch("assignments/:id") updateAssignment(@Headers() h: Record<string, string>, @Param("id") id: string, @Body() b: Record<string, unknown>) { return this.service.updateAssignment(this.user(h), id, b as never); }
  @Get("reports") listReports(@Headers() h: Record<string, string>) { return this.service.listReports(this.user(h)); }
  @Post("reports") createReport(@Headers() h: Record<string, string>, @Body() b: Record<string, unknown>) { return this.service.createReport(this.user(h), b as never); }
}
