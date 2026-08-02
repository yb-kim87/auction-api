import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity("course_videos")
export class CourseVideo {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  sectionId!: string;

  @Column()
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  /** Bunny Stream 라이브러리 내 영상 GUID. 재생 URL은 서버에서
   * BUNNY_STREAM_LIBRARY_ID + 이 값으로 조립한다(프론트에 키 노출 안 함). */
  @Column()
  bunnyVideoId!: string;

  @Column({ type: "integer", nullable: true })
  durationSeconds!: number | null;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @Column({ default: false })
  isPublished!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
