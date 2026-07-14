/**
 * 입찰가 산정 및 수익률 분석 계산기.
 * 프론트(auction/src/lib/profit-calculator.ts)와 동일 로직 — 목표수익 필터를 서버에서
 * 처리하기 위해 백엔드에도 동일하게 복제해둔다. 계산식을 고칠 때는 양쪽을 함께 수정해야 한다.
 */

/** 낙찰가(취득세 과세표준) 구간별 취득세율(지방교육세 등 포함) */
export function acquisitionTaxRate(minPriceWon: number): number {
  let base: number;
  if (minPriceWon <= 600_000_000) base = 0.01;
  else if (minPriceWon <= 650_000_000) base = 0.0133;
  else if (minPriceWon <= 700_000_000) base = 0.0167;
  else if (minPriceWon <= 750_000_000) base = 0.02;
  else if (minPriceWon <= 800_000_000) base = 0.0233;
  else if (minPriceWon <= 850_000_000) base = 0.0267;
  else base = 0.03;
  return base * 1.1 + 0.007;
}

/** 매도가 구간별 매도 중개수수료율 */
export function saleBrokerageRate(salePriceWon: number): number {
  if (salePriceWon < 50_000_000) return 0.006;
  if (salePriceWon < 200_000_000) return 0.005;
  if (salePriceWon < 900_000_000) return 0.004;
  if (salePriceWon < 1_200_000_000) return 0.005;
  if (salePriceWon < 1_500_000_000) return 0.006;
  return 0.007;
}

/** 양도소득세 과세표준 구간별 세율/누진공제액 */
const CAPITAL_GAINS_TAX_BRACKETS: Array<{ upTo: number; rate: number; deduction: number }> = [
  { upTo: 14_000_000, rate: 0.06, deduction: 0 },
  { upTo: 50_000_000, rate: 0.15, deduction: 1_260_000 },
  { upTo: 88_000_000, rate: 0.24, deduction: 5_220_000 },
  { upTo: 150_000_000, rate: 0.35, deduction: 14_900_000 },
  { upTo: 300_000_000, rate: 0.38, deduction: 19_400_000 },
  { upTo: 500_000_000, rate: 0.4, deduction: 25_400_000 },
  { upTo: 1_000_000_000, rate: 0.42, deduction: 35_400_000 },
  { upTo: Infinity, rate: 0.45, deduction: 65_400_000 },
];

export function capitalGainsTaxBracket(taxBaseWon: number): { rate: number; deduction: number } {
  const bracket =
    CAPITAL_GAINS_TAX_BRACKETS.find((b) => taxBaseWon <= b.upTo) ??
    CAPITAL_GAINS_TAX_BRACKETS[CAPITAL_GAINS_TAX_BRACKETS.length - 1];
  return { rate: bracket.rate, deduction: bracket.deduction };
}

/** 과세표준에 대한 누진세액(세율×과세표준-누진공제). 0 이하는 0. */
export function progressiveTaxAmount(taxBaseWon: number, applyDeduction: boolean): number {
  if (taxBaseWon <= 0) return 0;
  const { rate, deduction } = capitalGainsTaxBracket(taxBaseWon);
  return Math.max(0, taxBaseWon * rate - (applyDeduction ? deduction : 0));
}

export interface ProfitCalculatorInput {
  minPrice: number;
  appraisedValue: number;
  bidPrice: number;
  salePrice: number;
  holdingMonths: number;
  loanRatioByAppraisal: number;
  loanRatioByBidPrice: number;
  incomeLoanLimit: number | null;
  existingLoanWon: number;
  loanInterestRate: number;
  earlyRepaymentFeeRate: number;
  interiorCost: number;
  evictionCost: number;
  unpaidMaintenanceFee: number;
  extraRealtyFee: number;
  isOver85sqm: boolean;
  vatAmount: number;
  applyProgressiveDeduction: boolean;
  existingIncome: number;
}

export interface ProfitCalculatorResult {
  bidRatio: number;
  loanByAppraisal: number;
  loanByBidPrice: number;
  loanLimit: number;
  loanAmount: number;
  equity: number;
  acquisitionTaxRate: number;
  acquisitionTax: number;
  loanInterest: number;
  earlyRepaymentFee: number;
  saleBrokerageRate: number;
  saleBrokerageFee: number;
  totalAcquisitionCost: number;
  saleMargin: number;
  capitalGainsTaxRate: number;
  capitalGainsTaxDeduction: number;
  capitalGainsTax: number;
  finalProfit: number;
  profitRate: number;
}

export function calculateProfit(input: ProfitCalculatorInput): ProfitCalculatorResult {
  const {
    minPrice,
    appraisedValue,
    bidPrice,
    salePrice,
    holdingMonths,
    loanRatioByAppraisal,
    loanRatioByBidPrice,
    incomeLoanLimit,
    existingLoanWon,
    loanInterestRate,
    earlyRepaymentFeeRate,
    interiorCost,
    evictionCost,
    unpaidMaintenanceFee,
    extraRealtyFee,
    vatAmount,
    applyProgressiveDeduction,
    existingIncome,
  } = input;

  const bidRatio = minPrice > 0 ? bidPrice / minPrice : 0;

  const loanByAppraisal = Math.floor(appraisedValue * loanRatioByAppraisal);
  const loanByBidPrice = Math.floor(bidPrice * loanRatioByBidPrice);
  const loanLimit = Math.max(
    0,
    Math.min(loanByAppraisal, loanByBidPrice, incomeLoanLimit ?? Infinity),
  );
  const loanAmount = Math.max(0, loanLimit - Math.max(0, existingLoanWon));

  const taxRate = acquisitionTaxRate(bidPrice);
  const acquisitionTax = Math.round(bidPrice * taxRate);

  const loanInterest = Math.round((loanAmount * loanInterestRate) / 12 * holdingMonths);
  const earlyRepaymentFee = Math.round(loanAmount * earlyRepaymentFeeRate);

  const brokerageRate = saleBrokerageRate(salePrice);
  const saleBrokerageFee = Math.round(salePrice * brokerageRate);

  const totalAcquisitionCost =
    bidPrice +
    acquisitionTax +
    interiorCost +
    evictionCost +
    unpaidMaintenanceFee +
    saleBrokerageFee +
    loanInterest +
    earlyRepaymentFee;

  const equity = Math.max(0, totalAcquisitionCost - loanAmount);

  const saleMargin = salePrice - totalAcquisitionCost;
  const positiveMargin = Math.max(0, saleMargin);
  const positiveExistingIncome = Math.max(0, existingIncome);
  const combinedTaxBase = positiveExistingIncome + positiveMargin;

  // 한계세율 방식: 기존소득+매매차익 합산 과세표준의 세액에서, 기존소득만의 세액을
  // 뺀 나머지를 매매차익에 대한 증분세액으로 본다(종합소득세 실제 계산 방식과 동일).
  const { rate: capitalGainsTaxRate, deduction: bracketDeduction } =
    capitalGainsTaxBracket(combinedTaxBase);
  const capitalGainsTaxDeduction = applyProgressiveDeduction ? bracketDeduction : 0;
  const combinedTax = applyProgressiveDeduction
    ? progressiveTaxAmount(combinedTaxBase, true)
    : combinedTaxBase * capitalGainsTaxRate;
  const existingIncomeTax = applyProgressiveDeduction
    ? progressiveTaxAmount(positiveExistingIncome, true)
    : positiveExistingIncome * capitalGainsTaxBracket(positiveExistingIncome).rate;
  const capitalGainsTax = saleMargin > 0 ? Math.max(0, Math.round(combinedTax - existingIncomeTax)) : 0;

  const finalProfit = saleMargin - capitalGainsTax - extraRealtyFee - vatAmount;
  const profitRate = equity > 0 ? (finalProfit / equity) * 100 : 0;

  return {
    bidRatio,
    loanByAppraisal,
    loanByBidPrice,
    loanLimit,
    loanAmount,
    equity,
    acquisitionTaxRate: taxRate,
    acquisitionTax,
    loanInterest,
    earlyRepaymentFee,
    saleBrokerageRate: brokerageRate,
    saleBrokerageFee,
    totalAcquisitionCost,
    saleMargin,
    capitalGainsTaxRate,
    capitalGainsTaxDeduction,
    capitalGainsTax,
    finalProfit,
    profitRate,
  };
}

/** 물건의 area 문자열("40.41㎡" 등)에서 숫자를 추출해 85㎡ 초과 여부를 판정한다 */
export function isOver85Sqm(area: string | null | undefined): boolean {
  const num = Number.parseFloat(String(area ?? "").match(/[\d.]+/)?.[0] ?? "");
  return Number.isFinite(num) && num > 85;
}

/**
 * 프론트 ProfitCalculatorPanel의 초기 입력값(낙찰가=최저가, 매도가=감정가, 보유4개월,
 * 인테리어200만·명도비200만·미납관리비100만, 부가세=매도가×10%×50% 등)을 그대로 재현해
 * "추정 수익"을 계산한다. 대출한도는 감정가·낙찰가·소득 기준 중 최저값에서 기존대출을
 * 차감한 값(이 물건에 적용된 대출정책 계산 결과)을 그대로 사용한다.
 */
export function estimateDefaultProfit(params: {
  minPrice: number;
  appraisedValue: number;
  area: string | null | undefined;
  loanRatioByAppraisal: number;
  loanRatioByBidPrice: number;
  incomeLoanLimit?: number | null;
  existingLoanWon?: number;
}): ProfitCalculatorResult {
  const {
    minPrice,
    appraisedValue,
    area,
    loanRatioByAppraisal,
    loanRatioByBidPrice,
    incomeLoanLimit = null,
    existingLoanWon = 0,
  } = params;
  const over85 = isOver85Sqm(area);
  return calculateProfit({
    minPrice,
    appraisedValue,
    bidPrice: minPrice,
    salePrice: appraisedValue,
    holdingMonths: 4,
    loanRatioByAppraisal,
    loanRatioByBidPrice: Math.min(loanRatioByBidPrice, 1),
    incomeLoanLimit,
    existingLoanWon,
    loanInterestRate: 0.045,
    earlyRepaymentFeeRate: 0,
    interiorCost: 2_000_000,
    evictionCost: 2_000_000,
    unpaidMaintenanceFee: 1_000_000,
    extraRealtyFee: 0,
    isOver85sqm: over85,
    vatAmount: over85 ? Math.round(appraisedValue * 0.1 * 0.5) : 0,
    applyProgressiveDeduction: true,
    existingIncome: 0,
  });
}
