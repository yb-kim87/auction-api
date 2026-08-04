import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("lecture_progress")
@Index(["username", "courseId", "videoId", "chapterStartSeconds"], { unique: true })
export class LectureProgress {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  username!: string;

  @Index()
  @Column()
  courseId!: string;

  @Index()
  @Column()
  videoId!: string;

  /** 챕터가 없는 영상은 0, 챕터 영상은 해당 챕터 시작 시각. */
  @Column({ type: "integer", default: 0 })
  chapterStartSeconds!: number;

  @Column({ type: "integer", default: 0 })
  lastPositionSeconds!: number;

  @Column({ default: false })
  isCompleted!: boolean;

  @Column({ type: Date, nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
