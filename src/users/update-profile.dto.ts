export type UpdateProfileDto = {
  name?: string;
  currentPassword?: string;
  newPassword?: string;
  investableFunds?: string;
  existingLoanAmount?: string;
  housingCount?: number | string;
  targetReturn?: string;
  investmentGoal?: string;
  firstTimeBuyer?: boolean;
};
