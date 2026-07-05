/** "3억 5,000만원", "350000000" 등 → 원 단위 정수. 프런트 investment-money.ts와 동일 규칙. */
export function parseMoneyToWon(raw: string): number | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim().replace(/,/g, "");
  if (!text) return null;

  if (/^\d+$/.test(text)) {
    const n = Number.parseInt(text, 10);
    return n > 0 ? n : null;
  }

  let total = 0;
  const eok = text.match(/(\d+(?:\.\d+)?)\s*억/);
  const man = text.match(/(\d+(?:\.\d+)?)\s*만/);
  if (eok) total += parseFloat(eok[1]) * 100_000_000;
  if (man) total += parseFloat(man[1]) * 10_000;
  if (total > 0) return Math.round(total);

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
}

/** 회원정보(주택수·생애최초 여부)로 적용할 대출 정책을 선택 */
export function selectLoanPolicy(
  criteria: { housingCount: number; firstTimeBuyer: boolean },
  policies: LoanPolicyLike[],
): LoanPolicyLike | null {
  const byId = (id: string) => policies.find((p) => p.id === id) ?? null;
  if (criteria.housingCount <= 0) {
    return criteria.firstTimeBuyer ? byId("first_time") : byId("no_house");
  }
  if (criteria.housingCount === 1) return byId("one_house");
  return byId("multi_house");
}

export function requiredEquityForMinPrice(minPrice: number, loanRatio: number): number {
  if (!minPrice || minPrice <= 0) return 0;
  return Math.ceil(minPrice * (1 - loanRatio));
}
