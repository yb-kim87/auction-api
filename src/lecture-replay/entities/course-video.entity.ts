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

  /** true면 강의 전체가 OT강의(isOtCourse)로 지정돼 있지 않아도, 이
   * 영상 하나만 OT수강생에게 자동 공개된다(2026-08-02, 영상 단위
   * 선택 요청). */
  @Column({ default: false })
  isOtVideo!: boolean;

  /** 영상 1개를 여러 구간(챕터)으로 나눠 보여주기 위한 타임스탬프 목록.
   * 실제 파일은 하나(bunnyVideoId 그대로)지만, 강의 화면에서는 이 목록이
   * 있으면 영상 하나가 아니라 챕터별로 나뉘어 표시되고, 각 챕터를 누르면
   * 그 시작 시각부터 재생된다(Bunny iframe embed의 `t=초` 파라미터 이용).
   * startSeconds 오름차순으로 저장(사용자 요청, 2026-08-04: "영상 1개를
   * 올리면 시간을 알려주면 알려준 시간으로 섹션을 구분해서 나눠서 영상이
   * 보이도록"). */
  @Column({ type: "simple-json", nullable: true })
  chapters!: Array<{ title: string; startSeconds: number }> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
