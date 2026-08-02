import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity("courses")
export class Course {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ default: false })
  isPublished!: boolean;

  /** true면 UserRole.OT_STUDENT 등급 회원이 개별 수강권 없이도 자동으로
   * 볼 수 있는 "OT강의"로 취급한다(2026-08-02, 사용자 요청). */
  @Column({ default: false })
  isOtCourse!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
