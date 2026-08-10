const TX_HEADER = "계약일\t등기일\t층\t가격";
const TX_REG_DATE = "(?:\\d{2}\\.\\d{2}\\.|-|계약취소)";
const TX_TAB_ROW = new RegExp(
  `^(\\d{2}\\.\\d{2}\\.)\\t(${TX_REG_DATE})\\t(\\d+층)\\t(.+)$`,
);
const TX_SPACE_ROW = new RegExp(
  `^(\\d{2}\\.\\d{2}\\.)\\s+(${TX_REG_DATE})\\s+(\\d+층)\\s+(.+)$`,
);
const TX_YEAR = /(\d{4}년(?:\s*계약)?)/;

type TxRow = [string, string, string, string];

function parseTxRowLine(line: string): TxRow | null {
  let match = TX_TAB_ROW.exec(line);
  if (!match) {
    match = TX_SPACE_ROW.exec(line.replace(/\s+/g, " "));
  }
  if (!match) return null;
  return [match[1], match[2], match[3], match[4].trim()];
}

function isCancelledTxRow(row: TxRow): boolean {
  return row[1].replace(/\u00a0/g, " ").trim() === "계약취소";
}

function normalizeTxYearLabel(label: string): string {
  const match = /(\d{4})/.exec(label);
  return match ? `${match[1]}년 계약` : label.trim();
}

function extractTxRowsByYear(text: string): Array<[string, TxRow[]]> {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let currentYear: string | null = null;
  const yearOrder: string[] = [];
  const yearRows = new Map<string, Map<string, TxRow>>();

  for (const line of lines) {
    const yearMatch = TX_YEAR.exec(line);
    if (yearMatch) {
      currentYear = normalizeTxYearLabel(yearMatch[1]);
      if (!yearRows.has(currentYear)) {
        yearRows.set(currentYear, new Map());
        yearOrder.push(currentYear);
      }
      continue;
    }

    const row = parseTxRowLine(line);
    if (!row || !currentYear) continue;

    const bucket = yearRows.get(currentYear);
    if (!bucket) continue;
    bucket.set(row.join("\t"), row);
  }

  return yearOrder
    .map((year) => [year, Array.from(yearRows.get(year)?.values() ?? [])] as [string, TxRow[]])
    .filter(([, rows]) => rows.length > 0);
}

function countTxRowsByYear(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [yearLabel, rows] of extractTxRowsByYear(text)) {
    const yearMatch = /^(\d{4})/.exec(yearLabel);
    if (!yearMatch) continue;
    const year = yearMatch[1];
    counts[year] = rows.filter((row) => !isCancelledTxRow(row)).length;
  }
  return counts;
}

export function parseTradingCountFromDetail(text: string): string {
  const counts = countTxRowsByYear(text ?? "");
  const years = Object.keys(counts).sort((a, b) => b.localeCompare(a));
  if (years.length === 0) return "";
  return years.map((year) => `${year} ${counts[year]}건`).join(", ");
}

/** 저장된 "2026 5건, 2025 4건, 2024 2건" 형태 문자열(위 함수의 출력)을
 * 다시 연도→건수 맵으로 파싱한다. 상세필터의 "N개년 실거래 건수"
 * 필터(사용자 요청, 2026-08-10)에서 재사용 — 프론트
 * `AuctionDetailModal.tsx`의 `parseTradingCountSeries`와 동일한
 * 정규식/포맷을 쓴다(두 화면이 같은 저장 형식을 공유). */
export function parseTradingCountByYear(value: string | null | undefined): Map<number, number> {
  const countByYear = new Map<number, number>();
  for (const match of (value ?? "").matchAll(/(20\d{2})\s*(\d+)\s*건/g)) {
    const year = Number(match[1]);
    const count = Number(match[2]);
    if (Number.isFinite(year) && Number.isFinite(count)) countByYear.set(year, count);
  }
  return countByYear;
}

/** "최근 N개년" 실거래 건수 합계 — 화면의 "최근 3개년" 그래프와 동일하게
 * 올해를 포함한 직전 연도들(예: N=1이면 올해만, N=3이면 올해+작년+재작년)
 * 로 고정하고, 데이터 없는 연도는 0건으로 취급한다. */
export function sumRecentYearsTradingCount(
  tradingCount: string | null | undefined,
  years: number,
  currentYear = new Date().getFullYear(),
): number {
  const countByYear = parseTradingCountByYear(tradingCount);
  let sum = 0;
  for (let i = 0; i < years; i += 1) {
    sum += countByYear.get(currentYear - i) ?? 0;
  }
  return sum;
}
