/** 매일 작업(예약 크롤링) 결과 텔레그램 알림 문구 — 순수 함수(사용자 요청, 2026-10-30:
 * "설정한 시간에 업데이트가 제대로 잘됐는지랑 경매물건 몇 건이 신규로 업데이트됐는지"). */

export type DailyJobPresetResult = {
  /** 관심조건 이름(또는 "오늘 입찰일 물건"). */
  label: string;
  /** 수집된(조회 대상) URL 수. */
  collected?: number;
  /** 조회 완료 처리된 건수. */
  completed?: number;
  /** DB에 신규 등록된 경매물건 수. */
  created: number;
  /** DB에서 갱신된 경매물건 수. */
  updated: number;
  /** 이 관심조건 처리 중 난 오류. */
  error?: string;
  /** 조회 완료 대기 시간을 넘겨 다음 관심조건으로 넘어갔는지. */
  timedOut?: boolean;
  /** 참고(예: 수집된 URL 없음, 대상 물건 없음). */
  note?: string;
};

const kstFormat = (d: Date, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", ...opts }).format(d);
const hm = (d: Date) => kstFormat(d, { hour: "2-digit", minute: "2-digit", hour12: false });
const md = (d: Date) => kstFormat(d, { month: "numeric", day: "numeric" });

function duration(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${secs % 60}초`;
  return `${secs}초`;
}

/** 실행이 끝났을 때 보내는 결과 알림. */
export function buildDailyJobReport(a: {
  scheduleTime: string;
  startedAt: number;
  finishedAt: number;
  results: DailyJobPresetResult[];
  /** 관심조건 단위가 아니라 예약 작업 전체가 실패한 경우의 오류. */
  fatalError: string | null;
}): string {
  const started = new Date(a.startedAt);
  const finished = new Date(a.finishedAt);
  const failed = a.results.filter((r) => r.error);
  const allFailed = (a.results.length > 0 && failed.length === a.results.length) || (!!a.fatalError && a.results.length === 0);
  const hasProblem = failed.length > 0 || !!a.fatalError;
  const timedOut = a.results.some((r) => r.timedOut);
  const icon = allFailed ? "❌" : hasProblem ? "⚠️" : timedOut ? "⚠️" : "✅";
  const title = allFailed ? "실패" : hasProblem ? "일부 실패" : timedOut ? "완료(대기 시간 초과 있음)" : "완료";
  const created = a.results.reduce((n, r) => n + r.created, 0);
  const updated = a.results.reduce((n, r) => n + r.updated, 0);
  const collected = a.results.reduce((n, r) => n + (r.collected ?? 0), 0);
  const completed = a.results.reduce((n, r) => n + (r.completed ?? 0), 0);

  const lines = [
    `${icon} 매일 작업 ${title} (설정 ${a.scheduleTime})`,
    `${md(started)} ${hm(started)} 시작 → ${hm(finished)} 종료 (${duration(a.finishedAt - a.startedAt)})`,
    `관심조건 ${a.results.length}개${collected ? ` · 조회 대상 ${collected.toLocaleString("ko-KR")}건 중 ${completed.toLocaleString("ko-KR")}건 처리` : ""}`,
    `경매물건 신규 ${created.toLocaleString("ko-KR")}건 · 갱신 ${updated.toLocaleString("ko-KR")}건`,
  ];
  if (created === 0 && updated === 0 && !hasProblem) lines.push("이번에는 신규·갱신된 물건이 없습니다.");

  for (const r of a.results.slice(0, 8)) {
    if (r.error) lines.push(`❌ ${r.label}: ${r.error}`);
    else lines.push(`• ${r.label}: 신규 ${r.created} · 갱신 ${r.updated}${r.note ? ` (${r.note})` : ""}${r.timedOut ? " ⏱️대기 시간 초과" : ""}`);
  }
  if (a.results.length > 8) lines.push(`…외 관심조건 ${a.results.length - 8}개`);
  if (a.fatalError) lines.push(`❌ 예약 작업 오류: ${a.fatalError}`);
  if (timedOut) lines.push("⏱️ 조회 완료 대기 시간(30분)을 넘겨 다음 관심조건으로 넘어간 항목이 있습니다. 해당 조회는 계속 진행 중일 수 있습니다.");
  return lines.join("\n").slice(0, 3800);
}

/** 설정한 시각이 됐는데 실행하지 못했을 때의 알림. */
export function buildDailyJobSkipMessage(reason: "restarting" | "busy" | "no-presets", scheduleTime: string): string {
  if (reason === "restarting") {
    return `⏸️ 매일 작업을 실행하지 못했습니다 (설정 ${scheduleTime})\n서버가 방금 재시작되어 준비 중이었습니다. 오늘 예약은 건너뛰었고 내일 같은 시각에 다시 실행됩니다. 필요하면 관리자 화면에서 수동으로 실행하세요.`;
  }
  if (reason === "busy") {
    return `⏸️ 매일 작업을 건너뛰었습니다 (설정 ${scheduleTime})\n다른 조회 작업이 진행 중이었습니다. 내일 같은 시각에 다시 실행됩니다. 필요하면 현재 작업이 끝난 뒤 관리자 화면에서 수동으로 실행하세요.`;
  }
  return `ℹ️ 매일 작업을 실행하지 않았습니다 (설정 ${scheduleTime})\n등록된 관심조건이 없습니다. 관리자 화면 > 물건 작업 > 매일 작업에서 관심조건을 추가하세요.`;
}
