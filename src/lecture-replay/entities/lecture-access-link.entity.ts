import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("lecture_access_links")
export class LectureAccessLink {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** /lecture/[token] URL에 쓰는 공개 토큰. 추측 불가능한 랜덤 문자열. */
  @Index({ unique: true })
  @Column()
  token!: string;

  @Index()
  @Column()
  courseId!: string;

  /** 링크 카드에 표시할 제목(강의 제목과 별개로 관리자가 자유롭게 붙임). */
  @Column()
  title!: string;

  @Column({ type: Date, nullable: true })
  expiresAt!: Date | null;

  @Column({ default: true })
  isActive!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
