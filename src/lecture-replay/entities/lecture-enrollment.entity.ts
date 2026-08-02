import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";

export enum LectureEnrollmentStatus {
  ACTIVE = "ACTIVE",
  EXPIRED = "EXPIRED",
  REVOKED = "REVOKED",
}

/** 회원별 강의 수강권. 이 프로젝트는 FK를 uuid가 아니라 User.username
 * 문자열로 참조하는 컨벤션을 쓴다(예: AuctionBidPlan) — 여기서도 동일하게
 * username을 쓴다. status는 관리자가 명시적으로 REVOKED로 바꾸는 경우만
 * 저장값으로 의미가 있고, ACTIVE↔EXPIRED는 배치 없이 조회 시점에
 * startsAt/expiresAt으로 매번 다시 계산한다(LectureReplayService 참고). */
@Entity("lecture_enrollments")
@Unique(["username", "courseId"])
export class LectureEnrollment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  username!: string;

  @Index()
  @Column()
  courseId!: string;

  @Column({ type: "timestamptz" })
  startsAt!: Date;

  @Column({ type: "timestamptz" })
  expiresAt!: Date;

  @Column({ type: "text", default: LectureEnrollmentStatus.ACTIVE })
  status!: LectureEnrollmentStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
