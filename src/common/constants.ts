export enum UserRole {
  ADMIN = "admin",
  CONSULTANT = "consultant",
  CONSULTING_STUDENT = "consulting_student",
  STUDENT = "student",
  MEMBER = "member",
}

export enum AuctionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export type AuthRole = `${UserRole}`;
