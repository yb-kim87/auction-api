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
