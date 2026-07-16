import { Controller, Get, Headers, Post } from "@nestjs/common";
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

  /** 최근 로그 파일 원문(마지막 N줄)을 관리자 화면에서 확인용으로 노출 */
  @Get("recent")
  async recent(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const raw = await this.logWriter.readAll();
    const lines = raw.split("\n").filter((l) => l.trim());
    return { lines: lines.slice(-200) };
  }
}
