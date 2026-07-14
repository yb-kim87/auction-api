/**
 * "3억 5,000만원", "5천만원", "1억 5천만원", "350000000" 등 → 원 단위 정수.
 * 프런트 investment-money.ts와 동일 규칙("천" 단위 포함).
 */
export function parseMoneyToWon(raw: string): number | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().replace(/,/g, "");
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number.parseInt(text, 10);
    return n > 0 ? n : null;
  }

  let total = 0;
  let matched = false;

  const eok = text.match(/(\d+(?:\.\d+)?)\s*억/);
  if (eok) {
    total += parseFloat(eok[1]) * 100_000_000;
    matched = true;
  }

  // "5천만원"처럼 숫자와 "만" 사이에 "천"이 끼는 복합 단위를 먼저 처리(안 그러면 숫자가 "만"과 붙어있지 않아 누락됨)
  const cheonMan = text.match(/(\d+(?:\.\d+)?)\s*천\s*만/);
  if (cheonMan) {
    total += parseFloat(cheonMan[1]) * 10_000_000;
    matched = true;
  }

  const man = text.match(/(\d+(?:\.\d+)?)\s*만/);
  if (man) {
    total += parseFloat(man[1]) * 10_000;
    matched = true;
  }

  if (!cheonMan) {
    const cheon = text.match(/(\d+(?:\.\d+)?)\s*천(?!\s*만)/);
    if (cheon) {
      total += parseFloat(cheon[1]) * 1_000;
      matched = true;
    }
  }

  if (matched && total > 0) return Math.round(total);

  const digits = text.replace(/[^\d]/g, "");
  if (digits) {
    const n = Number.parseInt(digits, 10);
    return n > 0 ? n : null;
  }
  return null;
}

export interface LoanPolicyLike {
  id: string;
  label: string;
  loanRatio: number;
  appraisalRatio: number;
  regulatedArea: boolean;
  loanUnavailable: boolean;
  businessLoanOnly: boolean;
}

/**
 * 회원정보(주택수·생애최초 여부)와 물건의 규제지역 여부로 적용할 대출 정책을 선택한다.
 * - 규제지역: 무주택(생애최초 포함)만 대출 가능(감정가 비율만 적용), 1주택 이상은 불가.
 * - 비규제지역: 무주택 일반/생애최초/1주택 이상(사업자대출)로 구분.
 */
export function selectLoanPolicy(
  criteria: { housingCount: number; firstTimeBuyer: boolean },
  regulatedArea: boolean,
  policies: LoanPolicyLike[],
): LoanPolicyLike | null {
  const byId = (id: string) => policies.find((p) => p.id === id) ?? null;
  if (regulatedArea) {
    return criteria.housingCount <= 0 ? byId("regulated_no_house") : byId("regulated_owner");
  }
  if (criteria.housingCount <= 0) {
    return criteria.firstTimeBuyer ? byId("unregulated_first_time") : byId("unregulated_no_house");
  }
  return byId("unregulated_owner");
}

/**
 * 감정가×감정가비율과 낙찰가(최저가)×낙찰가비율 중 더 낮은 금액이 실제 대출한도다
 * (경매 대출의 일반적인 산정 방식). 대출 불가 정책(loanUnavailable)이면 한도 0.
 */
export function maxLoanAmount(
  minPrice: number,
  appraisedValue: number,
  policy: Pick<LoanPolicyLike, "loanRatio" | "appraisalRatio" | "loanUnavailable">,
): number {
  if (policy.loanUnavailable) return 0;
  if (!minPrice || minPrice <= 0) return 0;
  const byMinPrice = minPrice * policy.loanRatio;
  const byAppraisal = appraisedValue > 0 ? appraisedValue * policy.appraisalRatio : Infinity;
  return Math.max(0, Math.floor(Math.min(byMinPrice, byAppraisal)));
}

export function requiredEquityForItem(
  minPrice: number,
  appraisedValue: number,
  policy: Pick<LoanPolicyLike, "loanRatio" | "appraisalRatio" | "loanUnavailable">,
): number {
  if (!minPrice || minPrice <= 0) return 0;
  return Math.max(0, minPrice - maxLoanAmount(minPrice, appraisedValue, policy));
}

export type ProgressStatus = "all" | "active" | "ended";

/** 프런트 lib/progress-status-filter.ts의 parseBidDate와 동일 규칙 */
function parseBidDate(value: string): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(/\./g, "-").replace(/\//g, "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 프런트 lib/progress-status-filter.ts의 matchesProgressStatus와 동일 규칙 */
export function matchesProgressStatus(bidDate: string, status: ProgressStatus): boolean {
  if (status === "all") return true;
  const parsed = parseBidDate(bidDate);
  if (!parsed) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const bidDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  if (status === "active") return bidDay >= today;
  return bidDay < today;
}

/** 프런트 lib/failure-rate.ts의 matchesFailureRateFilter와 동일 규칙 */
export function matchesFailureRateFilter(
  minPrice: number,
  appraisedValue: number,
  selectedRate: string,
): boolean {
  if (!selectedRate) return true;
  if (!minPrice || !appraisedValue || appraisedValue <= 0) return false;
  const ratio = Math.round((minPrice / appraisedValue) * 100);
  return ratio === Number(selectedRate);
}

const VILLA_USAGE_TYPES = new Set(["다세대주택", "도시형생활주택", "연립주택"]);

/** 프런트 data/property-type-options.ts의 matchesPropertyType과 동일 규칙 */
export function matchesPropertyType(
  item: { usage: string; propType: string },
  selected: string,
): boolean {
  if (!selected) return true;
  if (selected === "아파트") return item.usage === "아파트";
  if (selected === "빌라") return VILLA_USAGE_TYPES.has(item.usage) || item.propType === "빌라";
  return item.usage === selected;
}
