import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RequestLogWriterService, type RequestLogEntry } from "./request-log-writer.service";
import { SecurityLogIpExclusion } from "./security-log-ip-exclusion.entity";
import { OpenAiService } from "../ai/openai.service";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";

/** OpenAI 호출 빈도를 줄이기 위해 10분→30분으로 늘림(사용자 요청, 2026-08-01:
 *  10분 간격 자동 분석이 크레딧을 계속 소모해 정작 필요한 AI 권리분석이
 *  429로 막히는 문제가 있었음). */
const ANALYZE_INTERVAL_MINUTES = 30;
/** 이 시간 이전 로그는 통계에서 제외한다(매 주기 최근 구간만 본다) */
const WINDOW_MINUTES = 30;
/** 로그 라인이 너무 많으면 AI 프롬프트가 비대해지므로 통계로 압축해서 넘긴다 */
const TOP_N = 20;
/** 오래된 로그 삭제(purgeOld)를 이 간격으로 실행한다 — AI 분석과 달리
 * OpenAI/텔레그램 설정 여부와 무관하게 항상 동작해야 한다(사용자 요청,
 * 2026-07-22). */
const PURGE_INTERVAL_MINUTES = 60;

/**
 * 정상적인 외부 연동(구글 서비스 계정 Sheets API 등)에서 반복 오탐이
 * 확인된 초기 IP 목록(2026-07-16/17). 최초 기동 시 DB(security_log_ip_exclusions)에
 * 시드로 넣어두고, 이후로는 관리자가 화면에서 직접 추가/삭제한다.
 * 대역 전체가 아니라 IP 단위로만 등록해 감지 범위 축소를 최소화한다.
 */
const SEED_EXCLUDED_IPS: Array<{ ip: string; note: string }> = [
  { ip: "34.116.22.6", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "35.187.134.140", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "35.243.23.37", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "35.187.134.141", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "34.116.21.33", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "35.243.23.39", note: "구글 서비스 계정(Sheets API) 추정 - 2026-07-16" },
  { ip: "35.187.134.139", note: "Google Apps Script 추정 - 2026-07-17" },
  { ip: "35.187.143.69", note: "Google Apps Script 추정 - 2026-07-17" },
  { ip: "35.243.23.38", note: "Google Apps Script 추정 - 2026-07-17" },
  { ip: "34.116.21.34", note: "Google Apps Script 추정 - 2026-07-17" },
  {
    ip: "::ffff:127.0.0.1",
    note: "서버 자기 자신(크롤러→운영 DB 동시 적재 배치, /crawler/import-item) - 2026-08-20",
  },
  { ip: "127.0.0.1", note: "서버 자기 자신(로컬호스트) - 2026-08-20" },
  { ip: "::1", note: "서버 자기 자신(로컬호스트, IPv6) - 2026-08-20" },
];

/**
 * Google Apps Script(인스타그램 인스턴트 구글시트 연동)는 GCP 임대 IP를
 * 매번 다르게 써서 IP 단위 화이트리스트를 계속 추가해야 하는 문제가 있었음
 * (2026-07-17). IP 대신 User-Agent로 걸러낸다 — Apps Script의 User-Agent는
 * "Google-Apps-Script"를 포함하는 고정된 값이라 IP보다 안정적인 식별자.
 */
const EXCLUDED_USER_AGENT_SUBSTRINGS = ["Google-Apps-Script"];

/**
 * 프론트(Vercel)가 브라우저 요청을 서버사이드로 프록시해 백엔드로 넘기기
 * 때문에, 관리자든 일반 회원이든 정상적으로 사이트를 쓰기만 해도 원래
 * 브라우저 UA 대신 Node의 기본 User-Agent(예: "node")로 찍힌다. 원래는
 * "node UA + 관리자 계정으로 로그인된 요청"만 예외 처리했었는데
 * (2026-07-18, 개발자 본인 테스트 요청 오탐 다수 발생 당시엔 이 프록시
 * 구조의 영향 범위를 admin 계정 테스트로만 좁게 봤음), 실제로는 모든
 * 회원 트래픽이 동일하게 영향을 받아 일반 회원의 정상 이용까지 계속
 * 오탐으로 텔레그램에 보고되고 있었다(2026-08-19, 사용자 신고: "회원들의
 * 간단한 행동들도 전부다 보고가 되고 있는거 같다"). node UA는 사람이
 * 아니라는 신호이지만 동시에 해커도 흉내 낼 수 있는 값이라 User-Agent만
 * 으로 전역 예외하면 탐지를 무력화하는 구멍이 생기므로, 여전히 "로그인된
 * 요청"일 때만 예외로 두어 로그인 없이 접근하는 외부 공격은 그대로
 * 잡히게 한다 — 다만 그 로그인 계정을 admin으로 한정하지 않고 아무
 * 계정이나 인정하도록 넓혔다.
 */
const EXCLUDED_USER_AGENT_EXACT = ["node"];

function isExcludedUserAgent(userAgent: string, username?: string): boolean {
  if (EXCLUDED_USER_AGENT_SUBSTRINGS.some((needle) => userAgent.includes(needle))) return true;
  if (EXCLUDED_USER_AGENT_EXACT.includes(userAgent.trim())) {
    return Boolean(username?.trim());
  }
  return false;
}

/**
 * 관리자(admin) 본인이 로그인해서 화면을 정상 사용할 때도 /users/me,
 * /recommendations, /favorites 등을 연속 호출하는 패턴이 매 페이지
 * 로드마다 발생해 짧은 간격·다수 경로 조건에 걸려 오탐이 반복됐다
 * (2026-07-22, 사용자 신고). IP는 매번 바뀔 수 있어 IP 화이트리스트로는
 * 못 막으므로 "admin으로 로그인된 요청"을 통계 집계 자체에서 제외한다.
 * 로그 테이블에는 그대로 남으므로 감사 추적은 유지된다 — 계정 탈취 후
 * 오남용을 완전히 놓치지 않도록, 완전 무시가 아니라 통계 판단에서만
 * 제외하는 것이 목적이다.
 */
const ANALYSIS_EXCLUDED_USERNAMES = ["admin"];

function isExcludedUsername(username?: string): boolean {
  return Boolean(username && ANALYSIS_EXCLUDED_USERNAMES.includes(username));
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
    @InjectRepository(SecurityLogIpExclusion)
    private readonly ipExclusionRepo: Repository<SecurityLogIpExclusion>,
  ) {}

  private purgeTimer: ReturnType<typeof setInterval> | null = null;

  async onModuleInit() {
    await this.seedInitialExclusions();

    this.purgeTimer = setInterval(
      () => void this.logWriter.purgeOld().catch(() => {}),
      PURGE_INTERVAL_MINUTES * 60_000,
    );
    void this.logWriter.purgeOld().catch(() => {});

    if (!this.openAi.isConfigured() || !this.telegramAlert.isConfigured()) {
      this.logger.log(
        "보안 로그 분석 스케줄러 비활성화(OPENAI_API_KEY 또는 TELEGRAM 설정 없음)",
      );
      return;
    }
    this.timer = setInterval(() => void this.runOnce(), ANALYZE_INTERVAL_MINUTES * 60_000);
    this.logger.log(`보안 로그 분석 스케줄러 시작(${ANALYZE_INTERVAL_MINUTES}분 간격)`);
  }

  /** 최초 기동 시에만 초기 화이트리스트를 심는다(이미 있으면 건드리지 않음). */
  private async seedInitialExclusions(): Promise<void> {
    for (const seed of SEED_EXCLUDED_IPS) {
      const exists = await this.ipExclusionRepo.findOne({ where: { ip: seed.ip } });
      if (!exists) {
        await this.ipExclusionRepo.save(this.ipExclusionRepo.create(seed));
      }
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  private async runOnce(): Promise<void> {
    if (this.analyzing) return;
    this.analyzing = true;
    try {
      const cutoffDate = new Date(Date.now() - WINDOW_MINUTES * 60_000);
      const allEntries = await this.logWriter.findSince(cutoffDate);
      const excluded = new Set(
        (await this.ipExclusionRepo.find()).map((row) => row.ip),
      );
      const recent = allEntries.filter(
        (e) =>
          !excluded.has(e.ip) &&
          !isExcludedUserAgent(e.userAgent ?? "", e.username) &&
          !isExcludedUsername(e.username),
      );
      if (recent.length === 0) return;

      const stats = buildIpStats(recent);
      const result = await this.judge(stats);
      if (result.suspicious) {
        const statByIp = new Map(stats.map((s) => [s.ip, s]));
        const ipDetailLines = (
          result.suspiciousIps.length > 0 ? result.suspiciousIps : stats.map((s) => s.ip)
        ).map((ip) => {
          const s = statByIp.get(ip);
          if (!s) return `- ${ip}`;
          const usernames = s.usernames.size > 0 ? [...s.usernames].join(",") : "비로그인";
          const paths = [...s.paths].slice(0, 5).join(", ") + (s.paths.size > 5 ? " 외" : "");
          return `- ${ip} (계정: ${usernames} / 경로: ${paths})`;
        });
        await this.telegramAlert.send(
          `[보안 알림] 이상 요청 패턴이 감지되었습니다.\n\n${result.summary}\n\n의심 IP:\n${
            ipDetailLines.join("\n") || "특정 불가"
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

  async listExclusions(): Promise<SecurityLogIpExclusion[]> {
    return this.ipExclusionRepo.find({ order: { createdAt: "DESC" } });
  }

  async addExclusion(ip: string, note: string): Promise<SecurityLogIpExclusion> {
    const trimmed = ip.trim();
    if (!trimmed) {
      throw new Error("IP를 입력해 주세요.");
    }
    const existing = await this.ipExclusionRepo.findOne({ where: { ip: trimmed } });
    if (existing) return existing;
    return this.ipExclusionRepo.save(
      this.ipExclusionRepo.create({ ip: trimmed, note: note?.trim() ?? "" }),
    );
  }

  async removeExclusion(id: string): Promise<void> {
    await this.ipExclusionRepo.delete({ id });
  }
}
