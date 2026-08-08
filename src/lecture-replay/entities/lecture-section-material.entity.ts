import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** 주차(섹션)별 강의자료 파일(PPT/PDF 등) — 사용자 요청(2026-08-08):
 * "강의실에서 해당 주차에 대한 강의자료 올릴 수 있는 기능을 넣어줘".
 * 백엔드(Railway)와 프론트(Vercel)가 서로 다른 배포 환경이라 로컬
 * 파일시스템에 저장하면 재배포 때 사라지므로, 실제 파일 바이트를
 * Postgres(bytea)에 직접 저장해 영속성을 보장한다(별도 파일
 * 스토리지/CDN 계정이 구성돼 있지 않음 — Bunny Stream은 영상 전용).
 * 목록 조회는 fileData를 빼고 메타데이터만 반환해 payload를 가볍게
 * 유지한다. */
@Entity("lecture_section_materials")
export class LectureSectionMaterial {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column()
  sectionId!: string;

  @Column()
  title!: string;

  @Column()
  fileName!: string;

  @Column()
  mimeType!: string;

  @Column({ type: "bytea" })
  fileData!: Buffer;

  @Column({ type: "integer" })
  fileSize!: number;

  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
