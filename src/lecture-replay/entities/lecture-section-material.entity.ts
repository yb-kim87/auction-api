import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 주차(섹션)별 강의자료 — 사용자 요청(2026-08-08): "강의실에서 해당
 * 주차에 대한 강의자료 올릴 수 있는 기능을 넣어줘".
 *
 * 처음엔 파일 바이트를 Postgres(bytea)에 직접 저장했는데(별도 파일
 * 스토리지/CDN 계정이 없어서), 다운로드할 때마다 API 서버가 파일
 * 전체를 메모리로 읽어 스트리밍해야 해 트래픽이 몰리면 사이트 전체
 * (물건 검색 등)에 영향을 줄 수 있다는 우려가 있었다. 사용자가
 * "OneDrive에서 다운받게 하는건?"이라고 제안해, 관리자가 OneDrive에
 * 직접 올리고 공유 링크를 붙여넣는 방식으로 바꿨다 — 실제 파일 전송은
 * Microsoft 서버가 처리하므로 우리 백엔드는 링크 문자열만 다룬다
 * (2026-08-08, 링크 등록 방식 채택). */
@Entity("lecture_section_materials")
export class LectureSectionMaterial {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  sectionId!: string;

  @Column()
  title!: string;

  /** OneDrive(또는 다른 외부 저장소) 공유 링크. */
  @Column()
  url!: string;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
