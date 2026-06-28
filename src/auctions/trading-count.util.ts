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
