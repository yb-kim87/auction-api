type BaselineCandidate = {
  type: string;
  date: string;
  sourceLine: string;
};

export type RightsAnalysisFacts = {
  baselineCandidate: BaselineCandidate | null;
  claimAmounts: number[];
  hasCreditorWaiver: boolean;
  preBaselineTenantDates: string[];
  investigatedTenantStatus: "none" | "conflict" | "unknown";
  warnings: string[];
};

function parseWon(raw: string): number | null {
  const amount = Number(raw.replace(/[^\d]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function normalizeBaselineType(raw: string): string {
  const candidates = [
    "근저당권설정",
    "저당권설정",
    "강제경매개시결정",
    "임의경매개시결정",
    "강제경매",
    "임의경매",
    "가압류",
    "압류",
    "담보가등기",
    "전세권",
  ];
  return candidates.find((candidate) => raw.includes(candidate)) ?? raw;
}

export function extractRightsAnalysisFacts(input: {
  buildingRegistry?: string | null;
  tenantDetail?: string | null;
  tenantInfo?: string | null;
  specialNote?: string | null;
}): RightsAnalysisFacts {
  const registry = String(input.buildingRegistry ?? "").trim();
  const tenantDetail = String(input.tenantDetail ?? "").trim();
  const tenantInfo = String(input.tenantInfo ?? "").trim();
  const combined = `${registry}\n${tenantInfo}\n${tenantDetail}\n${input.specialNote ?? ""}`;
  const registryLines = registry
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let baselineCandidate: BaselineCandidate | null = null;
  for (let index = 0; index < registryLines.length; index += 1) {
    const line = registryLines[index];
    const nextLine = registryLines[index + 1] ?? "";
    const markerWrappedToNextLine =
      nextLine.includes("말소기준등기") &&
      !/^\S+\s+\d{4}-\d{2}-\d{2}\s+/.test(nextLine);
    if (!line.includes("말소기준등기") && !markerWrappedToNextLine) {
      continue;
    }
    const match = line.match(
      /^\S+\s+(\d{4}-\d{2}-\d{2})\s+([^\s(]+(?:권설정|경매|압류|가압류|가등기)?)/,
    );
    baselineCandidate = {
      date: match?.[1] ?? "",
      type: normalizeBaselineType(match?.[2] ?? ""),
      sourceLine: [line, markerWrappedToNextLine ? nextLine : ""]
        .filter(Boolean)
        .join(" "),
    };
    break;
  }

  const claimAmounts = [
    ...combined.matchAll(
      /(?:청구금액|채권금액|채권최고액)\s*[:：]?\s*([\d,]+)\s*원?/g,
    ),
  ]
    .map((match) => parseWon(match[1]))
    .filter((amount): amount is number => amount != null);

  const hasCreditorWaiver =
    /잔존\s*임차보증금반환채권을\s*포기|보증금\s*전액을\s*배당받지\s*못하더라도[^.\n]*포기/.test(
      combined,
    );

  const preBaselineTenantDates: string[] = [];
  if (baselineCandidate?.date) {
    for (const match of tenantDetail.matchAll(/전입:(\d{4}-\d{2}-\d{2})/g)) {
      if (match[1] < baselineCandidate.date) preBaselineTenantDates.push(match[1]);
    }
  }

  const explicitlyNoInvestigatedTenant =
    /조사된\s*임차\s*내역(?:이)?\s*(?:없음|없습니다)/.test(tenantDetail);
  const conflictingTenantEvidence =
    /(?:전입|확정|배당)\s*[:：]\s*\d{4}-\d{2}-\d{2}|보증금\s*[/：:]|임차인\s*[:：]\s*[^\s[\]{},]+/.test(
      `${tenantInfo}\n${tenantDetail}`,
    );
  const investigatedTenantStatus = explicitlyNoInvestigatedTenant
    ? conflictingTenantEvidence
      ? "conflict"
      : "none"
    : "unknown";

  const warnings: string[] = [];
  if (!registry || registry === "값없음") {
    warnings.push("등기 원문이 없어 말소기준권리를 확정할 수 없음");
  } else if (!baselineCandidate) {
    warnings.push("등기 원문에 명시적인 '(말소기준등기)' 표시를 찾지 못함");
  }
  if (claimAmounts.length > 0) {
    warnings.push(
      "청구금액·채권금액·채권최고액은 인수금액이 아니므로 별도 배당 근거 없이 합산 금지",
    );
  }
  if (preBaselineTenantDates.length > 0) {
    warnings.push(
      "말소기준일보다 빠른 전입일이 있으나 점유·대항요건과 배당 결과 확인 전에는 선순위 또는 인수금액 확정 금지",
    );
  }
  if (hasCreditorWaiver) {
    warnings.push(
      "잔존 임차보증금반환채권 포기 문구가 있으므로 해당 보증금 전액을 인수금액으로 계산 금지",
    );
  }
  if (investigatedTenantStatus === "none") {
    warnings.push(
      "법원 조사자료에 '조사된 임차내역 없음'이 명시되어 임차인 대항력과 임차보증금 인수권리는 없음으로 판단",
    );
  } else if (investigatedTenantStatus === "conflict") {
    warnings.push(
      "'조사된 임차내역 없음' 문구와 별도 임차인 자료가 함께 있어 충돌 확인 필요",
    );
  }

  return {
    baselineCandidate,
    claimAmounts: [...new Set(claimAmounts)],
    hasCreditorWaiver,
    preBaselineTenantDates: [...new Set(preBaselineTenantDates)],
    investigatedTenantStatus,
    warnings,
  };
}

export function formatRightsAnalysisFacts(facts: RightsAnalysisFacts): string {
  const baseline = facts.baselineCandidate
    ? `${facts.baselineCandidate.type || "종류 미추출"} ${facts.baselineCandidate.date || "일자 미추출"} / 원문: ${facts.baselineCandidate.sourceLine}`
    : "명시적 후보 없음";
  const claims =
    facts.claimAmounts.length > 0
      ? facts.claimAmounts.map((amount) => `${amount.toLocaleString("ko-KR")}원`).join(", ")
      : "없음";

  return `[서버 사전 점검 — 원문에서 기계적으로 추출한 사실]
- 명시된 말소기준등기 후보: ${baseline}
- 청구·채권 관련 금액: ${claims}
- 잔존 임차보증금반환채권 포기 문구: ${facts.hasCreditorWaiver ? "있음" : "없음"}
- 말소기준일보다 빠른 전입일: ${facts.preBaselineTenantDates.join(", ") || "없음 또는 비교 불가"}
- 법원 조사 임차내역: ${
    facts.investigatedTenantStatus === "none"
      ? "조사된 임차내역 없음(임차인 대항력·임차보증금 인수권리 없음)"
      : facts.investigatedTenantStatus === "conflict"
        ? "임차내역 없음 문구와 별도 임차자료가 충돌함"
        : "명시적 없음 문구 미확인"
  }
- 주의사항:
${facts.warnings.length > 0 ? facts.warnings.map((warning) => `  - ${warning}`).join("\n") : "  - 없음"}`;
}
