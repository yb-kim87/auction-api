/** 서버(Railway 컨테이너)는 기본 UTC로 동작하지만, "오늘"/"오후 5시" 같은
 * 업무 판단은 항상 한국시간(KST, UTC+9) 기준이어야 한다. Date.getHours()
 * 등은 실행 환경의 로컬 시간대를 그대로 반환해 환경마다 결과가 달라지므로
 * (서버는 UTC, 로컬 개발 PC는 보통 KST), Intl.DateTimeFormat으로
 * Asia/Seoul을 명시해 항상 같은 값을 얻는다. */
export function nowPartsInKst(): {
  year: number;
  month: number;
  date: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    date: get("day"),
    // 자정(00시)을 Intl이 "24"로 표기하는 로케일 이슈 방어
    hour: get("hour") % 24,
    minute: get("minute"),
  };
}

/** 오늘(KST 기준) 자정을 로컬 Date 객체로 반환 — 다른 Date와의 날짜만
 * 비교하는 용도(시/분은 항상 0). */
export function todayInKst(): Date {
  const { year, month, date } = nowPartsInKst();
  return new Date(year, month - 1, date);
}
