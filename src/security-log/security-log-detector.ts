import type { RequestLogEntry } from "./request-log-writer.service";

export type SecurityRuleCode =
  | "brute_force"
  | "endpoint_scan"
  | "high_rate"
  | "rapid_multi_path"
  | "distributed_login_attack"
  | "borderline_credential_probe"
  | "borderline_automation";

export interface IpStat {
  ip: string;
  count: number;
  paths: Set<string>;
  usernames: Set<string>;
  userAgents: Set<string>;
  minIntervalMs: number | null;
  errorCount: number;
  unauthorizedCount: number;
  notFoundCount: number;
  loginAttempts: number;
  loginFailures: number;
}

export interface DetectionCandidate {
  ip: string;
  ruleCode: SecurityRuleCode;
  severity: "warning" | "critical";
  summary: string;
  stat: IpStat;
  requiresAi: boolean;
}

function isLogin(entry: RequestLogEntry): boolean {
  return entry.method === "POST" && entry.path === "/auth/login";
}

export function buildIpStats(entries: RequestLogEntry[]): IpStat[] {
  const byIp = new Map<string, RequestLogEntry[]>();
  for (const entry of entries) {
    const list = byIp.get(entry.ip) ?? [];
    list.push(entry);
    byIp.set(entry.ip, list);
  }

  return [...byIp.entries()]
    .map(([ip, list]) => {
      list.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
      let minIntervalMs = Infinity;
      for (let index = 1; index < list.length; index += 1) {
        const gap = new Date(list[index].ts).getTime() - new Date(list[index - 1].ts).getTime();
        if (gap < minIntervalMs) minIntervalMs = gap;
      }
      const loginEntries = list.filter(isLogin);
      return {
        ip,
        count: list.length,
        paths: new Set(list.map((entry) => entry.path)),
        usernames: new Set(list.map((entry) => entry.username).filter(Boolean)),
        userAgents: new Set(list.map((entry) => entry.userAgent).filter(Boolean)),
        minIntervalMs: Number.isFinite(minIntervalMs) ? minIntervalMs : null,
        errorCount: list.filter((entry) => entry.status >= 400).length,
        unauthorizedCount: list.filter((entry) => entry.status === 401 || entry.status === 403).length,
        notFoundCount: list.filter((entry) => entry.status === 404).length,
        loginAttempts: loginEntries.length,
        // 409는 "비밀번호가 틀렸다"가 아니라 "이미 다른 기기에서 로그인
        // 중이라 거부됨"(계정당 동시 로그인 1개 제한, auth.service.ts의
        // ConflictException)이다. 이미 정상 로그인된 사용자가 다른 곳에서
        // 재로그인을 시도할 때도 이 상태코드가 나서, status>=400을 전부
        // "로그인 실패"로 세면 정상 사용자가 brute_force로 오탐된다
        // (실측, 2026-09-03: hyunyg 계정이 이미 로그인된 채 8분간 409를
        // 20회 이상 받았는데 다른 API는 전부 200으로 정상 이용 중이었음).
        loginFailures: loginEntries.filter((entry) => entry.status >= 400 && entry.status !== 409).length,
      };
    })
    .sort((a, b) => b.count - a.count);
}

function candidate(
  stat: IpStat,
  ruleCode: SecurityRuleCode,
  severity: DetectionCandidate["severity"],
  summary: string,
  requiresAi = false,
): DetectionCandidate {
  return { ip: stat.ip, ruleCode, severity, summary, stat, requiresAi };
}

export function detectIpCandidates(stat: IpStat): DetectionCandidate[] {
  const found: DetectionCandidate[] = [];
  const interval = stat.minIntervalMs ?? Infinity;
  const errorRate = stat.count > 0 ? stat.errorCount / stat.count : 0;

  if (stat.loginFailures >= 5 || (stat.loginAttempts >= 8 && stat.loginFailures >= 4)) {
    found.push(candidate(
      stat,
      "brute_force",
      "critical",
      `30분 동안 로그인 실패 ${stat.loginFailures}회가 반복되었습니다.`,
    ));
  } else if (stat.loginFailures >= 3 && interval <= 10_000) {
    found.push(candidate(
      stat,
      "borderline_credential_probe",
      "warning",
      `짧은 간격으로 로그인 실패 ${stat.loginFailures}회가 발생했습니다.`,
      true,
    ));
  }

  if (
    stat.errorCount >= 10 &&
    stat.paths.size >= 5 &&
    errorRate >= 0.7 &&
    (stat.unauthorizedCount + stat.notFoundCount >= 8)
  ) {
    found.push(candidate(
      stat,
      "endpoint_scan",
      "critical",
      `${stat.paths.size}개 경로에서 오류 ${stat.errorCount}건이 발생해 경로 스캔이 의심됩니다.`,
    ));
  }

  if (stat.count >= 120 && interval <= 500) {
    found.push(candidate(
      stat,
      "high_rate",
      "critical",
      `30분 동안 ${stat.count}건을 최소 ${interval}ms 간격으로 요청했습니다.`,
    ));
  } else if (stat.count >= 50 && stat.paths.size >= 20 && interval <= 500) {
    // 예전 임계값(count>=30, paths>=8)은 정상적으로 앱을 활발히 쓰는
    // 회원(강의 여러 개 넘나들며 영상 재생·질문·노트 확인 등)한테도
    // 쉽게 걸렸다 — SPA/모바일 앱이 화면 하나 들어갈 때 여러 API를
    // 거의 동시에(수ms 간격) 병렬 호출하는 게 흔한 정상 패턴이기
    // 때문(실측, 2026-09-03: hyewon319 계정, 아이폰, 36건/14경로/
    // 7ms — 3분 동안 강의실을 정상적으로 오간 것뿐이었음). 실제 경로
    // 스캔/정찰은 우리 앱이 쓰는 경로 수보다 훨씬 많은 종류의 경로를
    // 건드리는 경향이 있어, paths 임계값을 크게(8→20) 올려서 구분한다.
    found.push(candidate(
      stat,
      "rapid_multi_path",
      "critical",
      `${stat.paths.size}개 경로를 최소 ${interval}ms 간격으로 빠르게 순회했습니다.`,
    ));
  } else if (
    stat.count >= 10 &&
    stat.errorCount >= 5 &&
    stat.paths.size >= 3 &&
    interval <= 1_000
  ) {
    found.push(candidate(
      stat,
      "borderline_automation",
      "warning",
      `요청 ${stat.count}건 중 오류 ${stat.errorCount}건이 짧은 간격으로 발생했습니다.`,
      true,
    ));
  }

  return found;
}

export function detectDistributedLoginAttack(
  entries: RequestLogEntry[],
): DetectionCandidate | null {
  // 409(동시 로그인 제한 거부)는 자격증명 실패가 아니므로 제외한다(위
  // buildIpStats의 loginFailures와 동일한 이유).
  const failures = entries.filter(
    (entry) => isLogin(entry) && entry.status >= 400 && entry.status !== 409,
  );
  const ips = new Set(failures.map((entry) => entry.ip));
  if (failures.length < 20 || ips.size < 8) return null;

  const stat: IpStat = {
    ip: "여러 IP",
    count: failures.length,
    paths: new Set(["/auth/login"]),
    usernames: new Set(),
    userAgents: new Set(),
    minIntervalMs: null,
    errorCount: failures.length,
    unauthorizedCount: failures.filter((entry) => entry.status === 401 || entry.status === 403).length,
    notFoundCount: 0,
    loginAttempts: failures.length,
    loginFailures: failures.length,
  };
  return candidate(
    stat,
    "distributed_login_attack",
    "critical",
    `30분 동안 ${ips.size}개 IP에서 로그인 실패 ${failures.length}회가 발생했습니다.`,
  );
}

export function detectCandidates(entries: RequestLogEntry[]): DetectionCandidate[] {
  const candidates = buildIpStats(entries).flatMap(detectIpCandidates);
  const distributed = detectDistributedLoginAttack(entries);
  if (distributed) candidates.push(distributed);
  return candidates;
}

export function candidateFingerprint(candidate: DetectionCandidate): string {
  return `${candidate.ruleCode}:${candidate.ip}`;
}

