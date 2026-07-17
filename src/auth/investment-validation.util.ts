import { BadRequestException, ConflictException } from "@nestjs/common";

export interface InvestmentSignupInput {
  investableFunds?: string;
  existingLoanAmount?: string;
  housingCount?: number | string;
  creditScore?: string;
  annualNetIncome?: string;
  investmentGoal?: string;
  targetReturn?: string;
  firstTimeBuyer?: boolean;
}

const MIN_TEXT_LENGTH = 2;
// 투자목표 프리셋 중 "단기수익"(4자)이 가장 짧으므로 4자 이상으로 검증한다.
const MIN_GOAL_LENGTH = 4;

function normalizeMoneyText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isValidMoneyText(raw: string): boolean {
  const text = normalizeMoneyText(raw);
  if (!text) return false;
  // 순수 숫자는 "0"(없음)도 유효한 금액이므로 최소 길이 제한을 적용하지 않는다.
  if (/^\d+$/.test(text.replace(/,/g, ""))) return true;
  if (text.length < MIN_TEXT_LENGTH) return false;
  return /(\d|억|만|원|%)/.test(text);
}

export function validateInvestmentSignupFields(input: InvestmentSignupInput): {
  investableFunds: string;
  existingLoanAmount: string;
  housingCount: number;
  creditScore: string;
  annualNetIncome: string;
  investmentGoal: string;
  targetReturn: string;
  firstTimeBuyer: boolean;
} {
  const investableFunds = normalizeMoneyText(input.investableFunds ?? "");
  const existingLoanAmount = normalizeMoneyText(input.existingLoanAmount ?? "");
  const creditScore = normalizeMoneyText(input.creditScore ?? "");
  const annualNetIncome = normalizeMoneyText(input.annualNetIncome ?? "");
  const investmentGoal = (input.investmentGoal ?? "").replace(/\s+/g, " ").trim();
  const targetReturn = normalizeMoneyText(input.targetReturn ?? "");
  const housingCount =
    typeof input.housingCount === "number"
      ? input.housingCount
      : Number.parseInt(String(input.housingCount ?? ""), 10);

  // 목표 수익은 선택 항목 — 비워두면 목표수익 필터 없이 추천된다.
  if (
    !investableFunds ||
    !existingLoanAmount ||
    !creditScore ||
    !annualNetIncome ||
    !investmentGoal ||
    Number.isNaN(housingCount)
  ) {
    throw new ConflictException("모든 항목을 입력해 주세요.");
  }

  if (!isValidMoneyText(investableFunds)) {
    throw new BadRequestException(
      "투자가능자금을 금액 형식으로 입력해 주세요. (예: 3억 5,000만원)",
    );
  }

  if (!isValidMoneyText(existingLoanAmount)) {
    throw new BadRequestException(
      "기존대출금액을 금액 형식으로 입력해 주세요. (없으면 0)",
    );
  }

  if (housingCount < 0 || housingCount > 99) {
    throw new BadRequestException("주택수는 0~99 사이 숫자로 입력해 주세요.");
  }

  if (creditScore.length < MIN_TEXT_LENGTH) {
    throw new BadRequestException("신용점수를 선택해 주세요.");
  }

  if (!isValidMoneyText(annualNetIncome)) {
    throw new BadRequestException("연순소득을 선택해 주세요.");
  }

  if (investmentGoal.length < MIN_GOAL_LENGTH) {
    throw new BadRequestException("투자목표를 선택하거나 5자 이상 입력해 주세요.");
  }

  if (targetReturn && targetReturn.length < MIN_TEXT_LENGTH) {
    throw new BadRequestException("목표 수익을 선택해 주세요.");
  }

  return {
    investableFunds,
    existingLoanAmount,
    housingCount,
    creditScore,
    annualNetIncome,
    investmentGoal,
    targetReturn,
    firstTimeBuyer: Boolean(input.firstTimeBuyer),
  };
}
