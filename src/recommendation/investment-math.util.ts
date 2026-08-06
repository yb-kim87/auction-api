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

/**
 * 연소득 전용 파싱. parseMoneyToWon과 달리 "0"(소득없음)을 유효한 값으로
 * 인정한다 — 투자가능자금 등 "0이면 무의미"인 필드와 달리, 소득은 0원이
 * 실제로 "대출 전혀 불가"를 뜻하는 유의미한 입력이기 때문이다.
 */
export function parseIncomeToWon(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (trimmed === "0") return 0;
  return parseMoneyToWon(raw ?? "");
}

export interface LoanPolicyLike {
  id: string;
  label: string;
  loanRatio: number;
  appraisalRatio: number;
  regulatedArea: boolean;
  loanUnavailable: boolean;
  businessLoanOnly: boolean;
  roomDeductionTarget?: RoomDeductionTarget;
}

/** 수도권(서울·경기·인천) 여부. 시/도 명 앞부분으로 판정한다. */
export function isMetropolitanArea(city: string | null | undefined): boolean {
  const c = (city ?? "").trim();
  return c.startsWith("서울") || c.startsWith("경기") || c.startsWith("인천");
}

const LOW_PRICE_NONMETRO_THRESHOLD_WON = 200_000_000;

/**
 * 오피스텔 또는 지방 아파트 공시가 2억 이하인지 여부.
 * - 오피스텔: 공시가와 관계없이 특례 대출정책을 적용한다.
 * - 지방 아파트: 비수도권이면서 공시가가 2억 이하일 때만 특례를 적용한다.
 * 해당하면 주택수·규제지역과 무관하게 특례 정책이 최우선 적용된다.
 */
export function isOfficetelOrLowPriceNonMetro(item: {
  usage?: string | null;
  city?: string | null;
  officialLandPrice?: number | null;
}): boolean {
  return isOfficetel(item) || isLowPriceNonMetroApartment(item);
}

export function isOfficetel(item: { usage?: string | null }): boolean {
  return (item.usage ?? "").includes("오피스텔");
}

export function isLowPriceNonMetroApartment(item: {
  usage?: string | null;
  city?: string | null;
  officialLandPrice?: number | null;
}): boolean {
  const officialLandPrice = item.officialLandPrice ?? 0;
  return (
    (item.usage ?? "").includes("아파트") &&
    !isMetropolitanArea(item.city) &&
    officialLandPrice > 0 &&
    officialLandPrice <= LOW_PRICE_NONMETRO_THRESHOLD_WON
  );
}

/**
 * 회원정보(주택수·생애최초 여부)와 물건의 규제지역 여부로 적용할 대출 정책을 선택한다.
 * - 오피스텔 또는 지방 아파트 공시가 2억 이하 물건은 주택수·규제지역 무관하게 최우선 적용.
 * - 규제지역: 무주택만 대출 가능(감정가 비율만 적용, 생애최초/일반 구분), 1주택 이상은 불가.
 * - 비규제지역: 무주택 일반/생애최초/1주택 이상(사업자대출)로 구분.
 */
export function selectLoanPolicy(
  criteria: { housingCount: number; firstTimeBuyer: boolean },
  regulatedArea: boolean,
  policies: LoanPolicyLike[],
  item?: { usage?: string | null; city?: string | null; officialLandPrice?: number | null },
): LoanPolicyLike | null {
  const byId = (id: string) => policies.find((p) => p.id === id) ?? null;
  if (item && isOfficetel(item)) {
    const officetel = byId("officetel");
    if (officetel) return officetel;
  }
  if (item && isLowPriceNonMetroApartment(item)) {
    const lowPriceApartment = byId("low_price_nonmetro_apartment");
    if (lowPriceApartment) return lowPriceApartment;
  }
  if (regulatedArea) {
    if (criteria.housingCount > 0) return byId("regulated_owner");
    return criteria.firstTimeBuyer ? byId("regulated_first_time") : byId("regulated_no_house");
  }
  if (criteria.housingCount <= 0) {
    return criteria.firstTimeBuyer ? byId("unregulated_first_time") : byId("unregulated_no_house");
  }
  return byId("unregulated_owner");
}

/** 방공제(방빼기) 적용 대상. "none"이면 미적용. */
export type RoomDeductionTarget = "none" | "appraisal" | "bid" | "both";

/**
 * 감정가×감정가비율, 낙찰가(최저가)×낙찰가비율, 연소득×소득배수(소득 기준 상한) 중
 * 가장 낮은 금액이 대출 정책·감정 기준 한도다. 대출 불가 정책이면 한도 0.
 * 소득 정보가 없으면(annualIncomeWon undefined) 소득 기준은 적용하지 않는다.
 *
 * 방공제는 min을 구한 뒤 결과에서 빼는 게 아니라, 적용 대상으로 지정된
 * 기준 금액(감정가 기준·낙찰가 기준 또는 둘 다)에서 먼저 차감한 뒤 그
 * 값들 중 최저가를 최종 한도로 삼는다(사용자 요청, 2026-08-05: "감정가면
 * 감정가60%-방빼기 와 낙찰가80% 중 낮은 금액이 최종 대출 금액").
 */
export function maxLoanAmount(
  minPrice: number,
  appraisedValue: number,
  policy: Pick<LoanPolicyLike, "loanRatio" | "appraisalRatio" | "loanUnavailable">,
  annualIncomeWon?: number,
  incomeLoanMultiplier?: number,
  roomDeductionWon = 0,
  roomDeductionTarget: RoomDeductionTarget = "none",
): number {
  if (policy.loanUnavailable) return 0;
  if (!minPrice || minPrice <= 0) return 0;
  let byMinPrice = minPrice * policy.loanRatio;
  let byAppraisal = appraisedValue > 0 ? appraisedValue * policy.appraisalRatio : Infinity;
  if (roomDeductionWon > 0) {
    if (roomDeductionTarget === "bid" || roomDeductionTarget === "both") byMinPrice -= roomDeductionWon;
    if (roomDeductionTarget === "appraisal" || roomDeductionTarget === "both") byAppraisal -= roomDeductionWon;
  }
  // 0원(소득없음)도 유효한 입력이라 그대로 반영한다. 소득 정보 자체가 없을
  // 때(undefined/null)만 소득 기준을 적용하지 않는다.
  const byIncome =
    annualIncomeWon != null ? Math.max(0, annualIncomeWon) * (incomeLoanMultiplier ?? 7) : Infinity;
  return Math.max(0, Math.floor(Math.min(byMinPrice, byAppraisal, byIncome)));
}

/**
 * 물건 매입에 필요한 자기자금. 대출 한도(감정가·낙찰가·소득 기준 중 최저)를 구한 뒤,
 * 기존 대출액만큼 그 한도에서 추가로 차감한다(기존 대출이 있으면 신규 대출 여력이 줄어듦).
 */
export function requiredEquityForItem(
  minPrice: number,
  appraisedValue: number,
  policy: Pick<LoanPolicyLike, "loanRatio" | "appraisalRatio" | "loanUnavailable">,
  annualIncomeWon?: number,
  existingLoanWon?: number,
  incomeLoanMultiplier?: number,
  roomDeductionWon = 0,
  roomDeductionTarget: RoomDeductionTarget = "none",
): number {
  if (!minPrice || minPrice <= 0) return 0;
  const loanLimit = maxLoanAmount(
    minPrice,
    appraisedValue,
    policy,
    annualIncomeWon,
    incomeLoanMultiplier,
    roomDeductionWon,
    roomDeductionTarget,
  );
  const availableLoan = Math.max(0, loanLimit - (existingLoanWon ?? 0));
  return Math.max(0, minPrice - availableLoan);
}

/**
 * 신용점수 문자열("750~799점", "900점 이상", "350점 미만" 등)에서 하한값을 파싱한다.
 * "~" 이전 또는 "점" 이전 숫자를 하한으로 본다. 파싱 실패 시 null(경고 대상 아님으로 취급).
 */
export function parseCreditScoreLowerBound(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  if (text.includes("미만")) {
    const match = text.match(/(\d+)/);
    return match ? Number(match[1]) - 1 : null;
  }
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

/** 신용점수 750점 미만이면 대출 확인이 필요하다고 경고한다. 정보 없으면 경고하지 않는다. */
export function needsCreditScoreWarning(creditScore: string | undefined): boolean {
  const lower = parseCreditScoreLowerBound(creditScore);
  return lower != null && lower < 750;
}

export type ProgressStatus = "all" | "active" | "ended";

const ENDED_CASE_STATES = new Set([
  "낙찰",
  "허가",
  "매각결정기일",
  "지급기한",
  "배당기일",
  "배당종결",
  "취하",
  "종결",
]);

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
export function matchesProgressStatus(
  bidDate: string,
  status: ProgressStatus,
  caseState?: string,
): boolean {
  if (status === "all") return true;
  if (ENDED_CASE_STATES.has((caseState ?? "").trim())) return status === "ended";
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
