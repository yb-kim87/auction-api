export type UpdateProfileDto = {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
  investableFunds?: string;
  existingLoanAmount?: string;
  housingCount?: number | string;
  creditScore?: string;
  annualNetIncome?: string;
  targetReturn?: string;
  investmentGoal?: string;
  firstTimeBuyer?: boolean;
};
