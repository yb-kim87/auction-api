type BaselineCandidate = {
  type: string;
  date: string;
  sourceLine: string;
};

export type RightsAnalysisFacts = {
  baselineCandidate: BaselineCandidate | null;
  claimAmounts: number[];
  hasCreditorWaiver: boolean;
  hasAcquisitionConditionChangeSignal: boolean;
  preBaselineTenantDates: string[];
  nonPriorTenantDates: string[];
  allKnownTenantDatesOnOrAfterBaseline: boolean;
  tenantEffectiveTiming: "next_day" | "immediate";
  investigatedTenantStatus: "none" | "conflict" | "unknown";
  occupancyEvidence: "owner" | "tenant" | "none" | "unknown";
  complexExceptionSignals: string[];
  warnings: string[];
};

export type DeterministicRightsDecision = {
  code:
    | "owner_occupied"
    | "no_tenant"
    | "junior_tenant"
    | "senior_tenant_waiver"
    | "senior_tenant_acquisition_condition_change"
    | "senior_tenant_review"
    | "insufficient_data";
  final: boolean;
  reviewStatus: "unknown" | "possible" | "none";
  tenantPriorityStatus: "unknown" | "possible" | "none";
  opposability: "unknown" | "possible" | "none";
  assumptionStatus: "unknown" | "possible" | "none";
  assumptionAmount: number | null;
  summary: string;
  reason: string;
  missingEvidence: string[];
  requiresRag: boolean;
};

export type RightsRuleSettings = {
  tenantEffectiveTiming?: "next_day" | "immediate";
  noInvestigatedTenantPolicy?: "auto_none" | "manual_review";
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
}, settings: RightsRuleSettings = {}): RightsAnalysisFacts {
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

  // 임차인 현황 조사자료의 "대항력: 인수조건변경" 표기는 HUG·LH 등
  // 보증기관이 임차권을 승계하며 잔존채권을 포기한 경우로 보고, 안전한
  // 물건으로 판정한다(사용자 결정, 2026-07-30, 2025타경8596 사례로
  // 정책 확정 — 처음엔 참고 문구로만 남기고 위험 등급은 그대로 두려
  // 했으나, 사용자가 "인수조건변경이면 안전한 물건으로 판정하고 대신
  // 매각물건명세서로 재확인하라는 문구만 달아달라"고 명시적으로
  // 요청해 정책 변경). 아래 buildDeterministicRightsDecision의
  // senior_tenant_acquisition_condition_change 분기 참고.
  const hasAcquisitionConditionChangeSignal = /대항력\s*[:：]\s*인수조건변경/.test(
    combined,
  );

  const preBaselineTenantDates: string[] = [];
  const nonPriorTenantDates: string[] = [];
  const tenantMoveInDates: string[] = [];
  if (baselineCandidate?.date) {
    for (const match of tenantDetail.matchAll(/전입\s*[:：]\s*(\d{4}-\d{2}-\d{2})/g)) {
      tenantMoveInDates.push(match[1]);
      if (match[1] < baselineCandidate.date) preBaselineTenantDates.push(match[1]);
      // 주택임대차 대항력은 인도와 주민등록을 마친 다음 날부터 발생한다.
      // 따라서 전입일이 말소기준권리일과 같아도 해당 권리보다 후순위다.
      const sameDayIsJunior = settings.tenantEffectiveTiming !== "immediate";
      if (
        match[1] > baselineCandidate.date ||
        (sameDayIsJunior && match[1] === baselineCandidate.date)
      ) {
        nonPriorTenantDates.push(match[1]);
      }
    }
  }
  const allKnownTenantDatesOnOrAfterBaseline =
    Boolean(baselineCandidate?.date) &&
    tenantMoveInDates.length > 0 &&
    tenantMoveInDates.every((date) =>
      settings.tenantEffectiveTiming === "immediate"
        ? date > baselineCandidate!.date
        : date >= baselineCandidate!.date,
    );

  const explicitlyNoInvestigatedTenant =
    /조사된\s*임차\s*내역(?:이)?\s*(?:없음|없습니다)|임차\s*정보\s*없음|임차인(?:이|은|는)?\s*(?:없|존재하지)/.test(
      `${tenantInfo}\n${tenantDetail}`,
    );
  const conflictingTenantEvidence =
    /(?:전입|확정|배당)\s*[:：]\s*\d{4}-\d{2}-\d{2}|보증금\s*[/：:]|임차인\s*[:：]\s*[^\s[\]{},]+/.test(
      `${tenantInfo}\n${tenantDetail}`,
    );
  const investigatedTenantStatus = explicitlyNoInvestigatedTenant
    ? conflictingTenantEvidence
      ? "conflict"
      : settings.noInvestigatedTenantPolicy === "manual_review"
        ? "unknown"
        : "none"
    : "unknown";
  const ownerOccupied =
    /소유자(?:가|의)?\s*(?:전부|일부)?\s*(?:점유|거주)|소유자\s*세대가\s*전입/.test(
      `${tenantInfo}\n${tenantDetail}`,
    );
  const tenantEvidence =
    conflictingTenantEvidence ||
    (!explicitlyNoInvestigatedTenant &&
      /임차인|임대차관계|주택임차권|상가임차권/.test(
        `${tenantInfo}\n${tenantDetail}`,
      ));
  const occupancyEvidence = ownerOccupied && !tenantEvidence
    ? "owner"
    : investigatedTenantStatus === "none"
      ? "none"
      : tenantEvidence
        ? "tenant"
        : "unknown";
  const complexExceptionSignals = [
    "유치권",
    "법정지상권",
    "분묘기지권",
    "지분매각",
    "대지권 미등기",
    "선순위 가처분",
    "선순위 가등기",
    "임차권등기",
  ].filter((signal) => combined.includes(signal));

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
  if (allKnownTenantDatesOnOrAfterBaseline) {
    warnings.push(
      "확인된 모든 임차인 전입일이 말소기준일과 같거나 늦고 대항력은 전입 다음 날 발생하므로 해당 임차인의 대항력과 임차보증금 인수권리는 없음",
    );
  }
  if (hasCreditorWaiver) {
    warnings.push(
      "잔존 임차보증금반환채권 포기 문구가 있으므로 해당 보증금 전액을 인수금액으로 계산 금지",
    );
  }
  if (hasAcquisitionConditionChangeSignal) {
    warnings.push(
      "임차인 현황 조사자료상 대항력 '인수조건변경' 신호가 있어 보증기관(HUG·LH 등) 승계로 안전한 물건으로 판단하되, 매각물건명세서로 임차권 포기 내용을 반드시 확인",
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
    hasAcquisitionConditionChangeSignal,
    preBaselineTenantDates: [...new Set(preBaselineTenantDates)],
    nonPriorTenantDates: [...new Set(nonPriorTenantDates)],
    allKnownTenantDatesOnOrAfterBaseline,
    tenantEffectiveTiming:
      settings.tenantEffectiveTiming === "immediate" ? "immediate" : "next_day",
    investigatedTenantStatus,
    occupancyEvidence,
    complexExceptionSignals,
    warnings,
  };
}

export function buildDeterministicRightsDecision(
  facts: RightsAnalysisFacts,
): DeterministicRightsDecision {
  const baselineDate = facts.baselineCandidate?.date ?? "";
  const postDates = facts.nonPriorTenantDates.join(", ");
  const priorDates = facts.preBaselineTenantDates.join(", ");
  // 임차권등기는 이미 취득한 대항력의 기준일을 보존하는 장치다. 확인된
  // 최초 전입일 자체가 말소기준일과 같거나 늦다면 임차권등기만으로
  // 선순위 대항력이 새로 생기지 않으므로 후순위 확정 판정을 막지 않는다.
  const effectiveComplexSignals = facts.allKnownTenantDatesOnOrAfterBaseline
    ? facts.complexExceptionSignals.filter((signal) => signal !== "임차권등기")
    : facts.complexExceptionSignals;
  const complexReason = effectiveComplexSignals.join(", ");

  const tenantNoneWithComplexException = (
    code: "owner_occupied" | "no_tenant" | "junior_tenant",
    summary: string,
    tenantReason: string,
  ): DeterministicRightsDecision => ({
    code,
    final: false,
    reviewStatus: "unknown",
    tenantPriorityStatus: "none",
    opposability: "none",
    assumptionStatus: "unknown",
    assumptionAmount: null,
    summary: `${summary} 다만 별도 예외 권리(${complexReason})는 추가 검토가 필요합니다.`,
    reason: `${tenantReason} 전체 인수 여부는 별도 예외 권리 검토 후 확정합니다.`,
    missingEvidence: [`별도 예외 권리 검토: ${complexReason}`],
    requiresRag: true,
  });

  if (facts.occupancyEvidence === "owner") {
    if (complexReason) {
      return tenantNoneWithComplexException(
        "owner_occupied",
        "법원 조사자료상 소유자가 점유하고 있어 대항력 있는 임차인은 확인되지 않습니다.",
        "소유자 점유로 인한 임차보증금 인수는 없습니다.",
      );
    }
    return {
      code: "owner_occupied",
      final: true,
      reviewStatus: "none",
      tenantPriorityStatus: "none",
      opposability: "none",
      assumptionStatus: "none",
      assumptionAmount: 0,
      summary: "법원 조사자료상 소유자가 점유하고 있어 대항력 있는 임차인은 확인되지 않습니다.",
      reason: "소유자 점유는 임대차보증금 반환채권이 아니므로 낙찰자가 인수할 임차보증금은 없습니다.",
      missingEvidence: [],
      requiresRag: false,
    };
  }

  if (facts.investigatedTenantStatus === "none") {
    if (complexReason) {
      return tenantNoneWithComplexException(
        "no_tenant",
        "법원 조사자료상 조사된 임차내역이 없어 대항력 있는 임차인은 없는 것으로 판단됩니다.",
        "임차인 관련 인수권리는 없습니다.",
      );
    }
    return {
      code: "no_tenant",
      final: true,
      reviewStatus: "none",
      tenantPriorityStatus: "none",
      opposability: "none",
      assumptionStatus: "none",
      assumptionAmount: 0,
      summary: "법원 조사자료상 조사된 임차내역이 없어 대항력 있는 임차인은 없는 것으로 판단됩니다.",
      reason: "조사된 임차내역이 없고 충돌하는 임차자료가 없어 낙찰자가 인수할 임차보증금은 없습니다.",
      missingEvidence: [],
      requiresRag: false,
    };
  }

  if (facts.allKnownTenantDatesOnOrAfterBaseline && baselineDate) {
    if (complexReason) {
      return tenantNoneWithComplexException(
        "junior_tenant",
        `확인된 전입일(${postDates})이 말소기준권리일(${baselineDate})과 같거나 늦어 해당 임차인은 낙찰자에게 대항할 수 없습니다.`,
        "해당 임차인의 보증금 인수는 없습니다.",
      );
    }
    return {
      code: "junior_tenant",
      final: true,
      reviewStatus: "none",
      tenantPriorityStatus: "none",
      opposability: "none",
      assumptionStatus: "none",
      assumptionAmount: 0,
      summary: `확인된 전입일(${postDates})이 말소기준권리일(${baselineDate})과 같거나 늦어 해당 임차인은 낙찰자에게 대항할 수 없습니다.`,
      reason: "적용 중인 대항력 발생 시점 규칙에 따라 후순위이므로 낙찰자가 인수할 임차보증금은 없습니다.",
      missingEvidence: [],
      requiresRag: false,
    };
  }

  if (facts.preBaselineTenantDates.length > 0 && facts.hasCreditorWaiver) {
    return {
      code: "senior_tenant_waiver",
      final: true,
      reviewStatus: "none",
      tenantPriorityStatus: "possible",
      opposability: "possible",
      assumptionStatus: "none",
      assumptionAmount: 0,
      summary: `말소기준권리일(${baselineDate})보다 빠른 전입일(${priorDates})이 있으나 잔존 임차보증금반환채권 포기 문구가 확인됩니다.`,
      reason: "명시된 잔존채권 포기 조건에 따라 배당 후 남는 임차보증금 반환채권을 낙찰자가 인수하지 않는 것으로 판단합니다.",
      missingEvidence: [],
      requiresRag: true,
    };
  }

  // 대항력 "인수조건변경"은 HUG·LH 등 보증기관이 임차권을 승계하며
  // 잔존채권을 포기한 경우가 실무상 대부분이라 안전한 물건으로
  // 분류하되, 매각물건명세서로 임차권 포기 내용을 직접 확인하라는
  // 문구를 항상 함께 남긴다(사용자 결정, 2026-07-30 — 2025타경8596
  // 사례로 정책 확정. hasCreditorWaiver처럼 명시적 포기 문구는 아니라
  // requiresRag는 유지해 RAG 검토·확인 안내를 이어간다).
  if (facts.preBaselineTenantDates.length > 0 && facts.hasAcquisitionConditionChangeSignal) {
    return {
      code: "senior_tenant_acquisition_condition_change",
      final: true,
      reviewStatus: "none",
      tenantPriorityStatus: "possible",
      opposability: "possible",
      assumptionStatus: "none",
      assumptionAmount: 0,
      summary: `말소기준권리일(${baselineDate})보다 빠른 전입일(${priorDates})이 있으나, 임차인 현황 조사자료상 대항력 '인수조건변경'(보증기관 승계) 신호가 확인되어 안전한 물건으로 판단됩니다.`,
      reason: "보증기관(HUG·LH 등)이 임차권을 승계하며 잔존 임차보증금반환채권을 포기한 것으로 보입니다. 다만 이는 조사자료의 분석 문구에 근거한 판단이므로, 반드시 매각물건명세서를 통해 임차권 포기 내용을 직접 확인하세요.",
      missingEvidence: ["매각물건명세서상 임차권 포기 내용 확인"],
      requiresRag: true,
    };
  }

  if (facts.preBaselineTenantDates.length > 0) {
    return {
      code: "senior_tenant_review",
      final: false,
      reviewStatus: "possible",
      tenantPriorityStatus: "possible",
      opposability: "possible",
      assumptionStatus: "unknown",
      assumptionAmount: null,
      summary: `말소기준권리일(${baselineDate})보다 빠른 전입일(${priorDates})이 있어 선순위 임차인 가능성이 있습니다.`,
      reason: "대항요건과 배당 결과가 확인되지 않아 낙찰자의 실제 인수금액은 아직 확정할 수 없습니다.",
      missingEvidence: ["임차인의 대항요건", "배당요구 및 예상 배당 결과", "미배당 보증금 잔액"],
      requiresRag: true,
    };
  }

  return {
    code: "insufficient_data",
    final: false,
    reviewStatus: "unknown",
    tenantPriorityStatus: "unknown",
    opposability: "unknown",
    assumptionStatus: "unknown",
    assumptionAmount: null,
    summary: "확정 판정에 필요한 말소기준권리 또는 임차인 자료가 부족합니다.",
    reason: "서버가 확정할 수 없는 복잡한 권리관계는 RAG 근거와 추가 자료를 함께 검토해야 합니다.",
    missingEvidence: [
      ...(baselineDate ? [] : ["말소기준권리 종류와 일자"]),
      "임차인 전입일 및 대항요건",
    ],
    requiresRag: true,
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
- 임차인 현황 조사자료상 대항력 '인수조건변경' 신호(보증기관 승계로 안전 판정, 매각물건명세서 확인 필요): ${facts.hasAcquisitionConditionChangeSignal ? "있음" : "없음"}
- 말소기준일보다 빠른 전입일: ${facts.preBaselineTenantDates.join(", ") || "없음 또는 비교 불가"}
- 말소기준일과 같거나 늦은 전입일: ${facts.nonPriorTenantDates.join(", ") || "없음 또는 비교 불가"}
- 적용 중인 대항력 발생 규칙: ${facts.tenantEffectiveTiming === "next_day" ? "요건 충족 다음 날 0시" : "요건 충족 즉시"}
- 확인된 전입일이 모두 말소기준일보다 후순위: ${facts.allKnownTenantDatesOnOrAfterBaseline ? "예(임차인 대항력·보증금 인수 없음)" : "아니오 또는 비교 불가"}
- 법원 조사 임차내역: ${
    facts.investigatedTenantStatus === "none"
      ? "조사된 임차내역 없음(임차인 대항력·임차보증금 인수권리 없음)"
      : facts.investigatedTenantStatus === "conflict"
        ? "임차내역 없음 문구와 별도 임차자료가 충돌함"
        : "명시적 없음 문구 미확인"
  }
- 서버 확정 판정: ${buildDeterministicRightsDecision(facts).summary}
- 복잡한 예외 RAG 검토 필요: ${buildDeterministicRightsDecision(facts).requiresRag ? "예" : "아니오"}
- 감지된 별도 예외 권리: ${facts.complexExceptionSignals.join(", ") || "없음"}
- 주의사항:
${facts.warnings.length > 0 ? facts.warnings.map((warning) => `  - ${warning}`).join("\n") : "  - 없음"}`;
}
