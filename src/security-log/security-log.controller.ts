import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { SecurityLogAnalyzerService } from "./security-log-analyzer.service";
import { RequestLogWriterService } from "./request-log-writer.service";

@Controller("security-log")
export class SecurityLogController {
  constructor(
    private readonly analyzer: SecurityLogAnalyzerService,
    private readonly logWriter: RequestLogWriterService,
  ) {}

  /** 관리자가 화면에서 즉시 AI 분석을 트리거하고 싶을 때 사용(정기 스케줄과 별개) */
  @Post("analyze-now")
  async analyzeNow(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.analyzer.runNow();
  }

  /** 최근 요청 로그(최신 200건)를 관리자 화면에서 확인용으로 노출 */
  @Get("recent")
  async recent(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const entries = await this.logWriter.findRecent(200);
    return { lines: entries.map((e) => JSON.stringify(e)) };
  }

  /** 최근 규칙 판정과 텔레그램 발송 결과 */
  @Get("alerts")
  async alerts(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.analyzer.listAlerts();
  }

  /** 분석 대상에서 제외할 IP 목록(화이트리스트) 조회 */
  @Get("ip-exclusions")
  async listIpExclusions(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.analyzer.listExclusions();
  }

  /** IP를 화이트리스트에 추가 — 관리자가 직접 등록(대역이 아니라 정확한 IP 단위) */
  @Post("ip-exclusions")
  async addIpExclusion(
    @Headers() headers: Record<string, string>,
    @Body() body: { ip: string; note?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.analyzer.addExclusion(body.ip, body.note ?? "");
  }

  /** 화이트리스트에서 IP 제거 */
  @Delete("ip-exclusions/:id")
  async removeIpExclusion(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    await this.analyzer.removeExclusion(id);
    return { removed: true };
  }
}
