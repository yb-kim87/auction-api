import { BadRequestException, ConflictException } from "@nestjs/common";

export interface InvestmentSignupInput {
  investableFunds?: string;
  existingLoanAmount?: string;
  housingCount?: number | string;
  investmentGoal?: string;
  targetReturn?: string;
  firstTimeBuyer?: boolean;
}

const MIN_TEXT_LENGTH = 2;
const MIN_GOAL_LENGTH = 5;

function normalizeMoneyText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function isValidMoneyText(raw: string): boolean {
  const text = normalizeMoneyText(raw);
  if (text.length < MIN_TEXT_LENGTH) return false;
  if (/^\d+$/.test(text.replace(/,/g, ""))) return true;
  return /(\d|억|만|원|%)/.test(text);
}

export function validateInvestmentSignupFields(input: InvestmentSignupInput): {
  investableFunds: string;
  existingLoanAmount: string;
  housingCount: number;
  investmentGoal: string;
  targetReturn: string;
  firstTimeBuyer: boolean;
} {
  const investableFunds = normalizeMoneyText(input.investableFunds ?? "");
  const existingLoanAmount = normalizeMoneyText(input.existingLoanAmount ?? "");
  const investmentGoal = (input.investmentGoal ?? "").replace(/\s+/g, " ").trim();
  const targetReturn = normalizeMoneyText(input.targetReturn ?? "");
  const housingCount =
    typeof input.housingCount === "number"
      ? input.housingCount
      : Number.parseInt(String(input.housingCount ?? ""), 10);

  if (
    !investableFunds ||
    !existingLoanAmount ||
    !investmentGoal ||
    !targetReturn ||
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

  if (investmentGoal.length < MIN_GOAL_LENGTH) {
    throw new BadRequestException("투자목표를 5자 이상 입력해 주세요.");
  }

  if (targetReturn.length < MIN_TEXT_LENGTH) {
    throw new BadRequestException("목표 수익을 입력해 주세요. (예: 연 8%)");
  }

  return {
    investableFunds,
    existingLoanAmount,
    housingCount,
    investmentGoal,
    targetReturn,
    firstTimeBuyer: Boolean(input.firstTimeBuyer),
  };
}
