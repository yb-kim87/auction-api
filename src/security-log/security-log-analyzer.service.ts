import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { RequestLogWriterService, type RequestLogEntry } from "./request-log-writer.service";
import { OpenAiService } from "../ai/openai.service";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";

const ANALYZE_INTERVAL_MINUTES = 10;
/** 이 시간 이전 로그는 통계에서 제외한다(매 주기 최근 구간만 본다) */
const WINDOW_MINUTES = 10;
/** 로그 라인이 너무 많으면 AI 프롬프트가 비대해지므로 통계로 압축해서 넘긴다 */
const TOP_N = 20;

/**
 * 정상적인 외부 연동으로 확인된 IP는 분석 대상에서 제외한다.
 * 구글 서비스 계정(Sheets API 등 GCP 인프라) 관련 트래픽으로 보이는 IP가
 * 10분 간격으로 반복 감지되어 오탐 알림이 발생함을 확인(2026-07-16).
 * 대역 전체가 아니라 실제로 알림에 등장한 IP만 정확히 화이트리스트한다 —
 * 대역 전체를 제외하면 같은 GCP 대역에서 오는 다른(실제) 위협 트래픽까지
 * 감지하지 못하게 되므로 범위를 넓히지 않는다.
 */
const EXCLUDED_IPS = new Set([
  "34.116.22.6",
  "35.187.134.140",
  "35.243.23.37",
  "35.187.134.141",
  "34.116.21.33",
  "35.243.23.39",
]);

function isExcludedIp(ip: string): boolean {
  return EXCLUDED_IPS.has(ip);
}

interface IpStat {
  ip: string;
  count: number;
  paths: Set<string>;
  usernames: Set<string>;
  userAgents: Set<string>;
  minIntervalMs: number;
  errorCount: number;
}

function parseLogLines(raw: string): RequestLogEntry[] {
  const lines = raw.split("\n").filter((l) => l.trim());
  const entries: RequestLogEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as RequestLogEntry);
    } catch {
      // 손상된 줄은 건너뜀
    }
  }
  return entries;
}

function buildIpStats(entries: RequestLogEntry[]): IpStat[] {
  const byIp = new Map<string, RequestLogEntry[]>();
  for (const e of entries) {
    const list = byIp.get(e.ip) ?? [];
    list.push(e);
    byIp.set(e.ip, list);
  }

  const stats: IpStat[] = [];
  for (const [ip, list] of byIp.entries()) {
    list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
    let minIntervalMs = Infinity;
    for (let i = 1; i < list.length; i++) {
      const gap = new Date(list[i].ts).getTime() - new Date(list[i - 1].ts).getTime();
      if (gap < minIntervalMs) minIntervalMs = gap;
    }
    stats.push({
      ip,
      count: list.length,
      paths: new Set(list.map((e) => e.path)),
      usernames: new Set(list.map((e) => e.username).filter(Boolean)),
      userAgents: new Set(list.map((e) => e.userAgent).filter(Boolean)),
      minIntervalMs: Number.isFinite(minIntervalMs) ? minIntervalMs : 0,
      errorCount: list.filter((e) => e.status >= 400).length,
    });
  }
  return stats.sort((a, b) => b.count - a.count).slice(0, TOP_N);
}

function summarizeForPrompt(stats: IpStat[], windowMinutes: number): string {
  if (stats.length === 0) return "(최근 구간에 요청 없음)";
  const lines = stats.map((s) => {
    const uaSample = [...s.userAgents][0]?.slice(0, 80) ?? "-";
    return `- IP ${s.ip}: 요청 ${s.count}건 / 최소간격 ${s.minIntervalMs}ms / 경로수 ${s.paths.size} / 로그인유저 ${
      s.usernames.size > 0 ? [...s.usernames].join(",") : "없음"
    } / 오류 ${s.errorCount}건 / UA: ${uaSample}`;
  });
  return `최근 ${windowMinutes}분간 상위 IP별 요청 통계:\n${lines.join("\n")}`;
}

interface SuspicionResult {
  suspicious: boolean;
  summary: string;
  suspiciousIps: string[];
}

/**
 * 요청 로그 파일을 주기적으로 읽어 대량요청·크롤링·자동화 스크립트로 의심되는
 * 패턴이 있는지 AI(OpenAI)에게 판단시키고, 의심되면 텔레그램으로 관리자에게 알린다.
 * OpenAI/텔레그램 키가 설정 안 돼 있으면 조용히 아무 동작도 하지 않는다.
 */
@Injectable()
export class SecurityLogAnalyzerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityLogAnalyzerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private analyzing = false;

  constructor(
    private readonly logWriter: RequestLogWriterService,
    private readonly openAi: OpenAiService,
    private readonly telegramAlert: TelegramAlertService,
  ) {}

  onModuleInit() {
    if (!this.openAi.isConfigured() || !this.telegramAlert.isConfigured()) {
      this.logger.log(
        "보안 로그 분석 스케줄러 비활성화(OPENAI_API_KEY 또는 TELEGRAM 설정 없음)",
      );
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), ANALYZE_INTERVAL_MINUTES * 60_000);
    this.logger.log(`보안 로그 분석 스케줄러 시작(${ANALYZE_INTERVAL_MINUTES}분 간격)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runOnce(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      const raw = await this.logWriter.readAll();
      const allEntries = parseLogLines(raw);
      const cutoff = Date.now() - WINDOW_MINUTES * 60_000;
      const recent = allEntries.filter(
        (e) => new Date(e.ts).getTime() >= cutoff && !isExcludedIp(e.ip),
      );
      if (recent.length === 0) return;

      const stats = buildIpStats(recent);
      const result = await this.judge(stats);
      if (result.suspicious) {
        await this.telegramAlert.send(
          `[보안 알림] 이상 요청 패턴이 감지되었습니다.\n\n${result.summary}\n\n의심 IP: ${
            result.suspiciousIps.join(", ") || "특정 불가"
          }`,
        );
        this.logger.warn(`이상행위 감지: ${result.summary}`);
      }
    } catch (err) {
      this.logger.error(
        `보안 로그 분석 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.analyzing = false;
    }
  }

  private async judge(stats: IpStat[]): Promise<SuspicionResult> {
    const systemPrompt = `당신은 웹 서비스의 API 요청 로그를 분석해 대량요청, 크롤링, 자동화
스크립트로 의심되는 접근 패턴을 찾아내는 보안 분석가입니다. 다음 기준을 참고하되
기계적으로 적용하지 말고 종합적으로 판단하세요.

- 짧은 시간에 동일 IP에서 매우 많은 요청(예: 10분간 수백 건)
- 요청 간격이 사람이 클릭하기엔 비정상적으로 짧고 일정함(예: 수십~수백ms 간격 반복)
- 로그인 없이 다수의 서로 다른 경로를 순차적으로 훑는 패턴(크롤링 의심)
- 오류(4xx) 비율이 비정상적으로 높은 경우(무차별 대입/스캐닝 의심)
- 일반 브라우저가 아닌 것으로 보이는 User-Agent(비어있음, curl, python-requests, bot 등)

로그인된 정상 관리자/회원의 정상적인 사용 패턴(가끔 빠른 클릭, 페이지네이션 등)은
과도하게 의심하지 마세요. 확실히 의심스러운 경우에만 suspicious=true로 답하세요.

반드시 JSON으로만 답하세요:
{
  "suspicious": boolean,
  "summary": "한국어로 2~3문장 요약(어떤 패턴이 왜 의심스러운지)",
  "suspiciousIps": ["의심되는 IP 목록"]
}`;

    const userPrompt = summarizeForPrompt(stats, WINDOW_MINUTES);

    try {
      const raw = await this.openAi.answerFreeform(systemPrompt, userPrompt);
      const jsonText = raw.trim().replace(/^```json\s*|```$/g, "");
      const parsed = JSON.parse(jsonText) as Partial<SuspicionResult>;
      return {
        suspicious: Boolean(parsed.suspicious),
        summary: String(parsed.summary ?? ""),
        suspiciousIps: Array.isArray(parsed.suspiciousIps)
          ? parsed.suspiciousIps.map((v) => String(v))
          : [],
      };
    } catch (err) {
      this.logger.warn(
        `AI 판단 응답 파싱 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { suspicious: false, summary: "", suspiciousIps: [] };
    }
  }

  /** 관리자 화면에서 즉시 실행할 때 사용 */
  async runNow(): Promise<{ ran: boolean; reason?: string }> {
    if (!this.openAi.isConfigured()) return { ran: false, reason: "OPENAI_API_KEY 미설정" };
    await this.runOnce();
    return { ran: true };
  }
}
