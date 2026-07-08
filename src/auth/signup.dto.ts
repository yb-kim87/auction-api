export interface SignupDto {
  username?: string;
  password?: string;
  name?: string;
  phone?: string;
  investableFunds?: string;
  existingLoanAmount?: string;
  housingCount?: number | string;
  creditScore?: string;
  annualNetIncome?: string;
  investmentGoal?: string;
  targetReturn?: string;
  firstTimeBuyer?: boolean;
}
