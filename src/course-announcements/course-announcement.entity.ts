import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 강의실(/courses/my) 대시보드에 노출되는 공지사항. 관리자가 등록/수정하면
 * 수강생 전체가 로그인 즉시 볼 수 있다(대출 문의 양식처럼 반복 안내가
 * 필요한 내용을 매번 개별 전달하지 않기 위한 용도, 2026-08-23). */
@Entity("course_announcements")
export class CourseAnnouncementRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
