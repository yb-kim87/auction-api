export enum UserRole {
  ADMIN = "admin",
  CONSULTANT = "consultant",
  CONSULTING_STUDENT = "consulting_student",
  STUDENT = "student",
  MEMBER = "member",
  /** 강의 다시보기의 "OT강의"로 지정된 강의만 볼 수 있는 등급(수강권을
   * 개별 부여하지 않아도 자동으로 시청 가능). 2026-08-02 추가. */
  OT_STUDENT = "ot_student",
}

export enum AuctionStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export type AuthRole = `${UserRole}`;
