import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export type BlogNoteKind = "consent" | "timeline" | "article" | "insight" | "diagnostic";

/** 구역 조사 때 재개발 블로그(후니동산)에서 찾아 저장한 구역 관련 정보 — 동의율(찬성/반대 추정)과 자치구 공문 타임라인.
 * 같은 구역·같은 글은 다시 조사할 때 통째로 갈아끼운다. 화면에는 글 작성일이 최신인 것을 우선 보여 주고 원문 링크를 단다. */
@Entity("redevelopment_zone_blog_notes")
@Index("IDX_redev_blog_note_zone", ["zoneId"])
export class RedevelopmentZoneBlogNote {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  zoneId!: string;

  @Column({ type: "varchar" })
  blogId!: string;

  @Column({ type: "varchar" })
  logNo!: string;

  @Column({ type: "text" })
  postTitle!: string;

  /** 글 작성일(YYYY-MM-DD). */
  @Column({ type: "text" })
  postedAt!: string;

  @Column({ type: "text" })
  url!: string;

  @Column({ type: "text" })
  kind!: BlogNoteKind;

  /** 글에서 뽑은 원문 한 줄(또는 공문 제목). */
  @Column({ type: "text" })
  text!: string;

  /** consent: 찬성률(%) — 없으면 null. */
  @Column({ type: "float", nullable: true })
  yesPct!: number | null;

  /** consent: 반대율(%) — 없으면 null. */
  @Column({ type: "float", nullable: true })
  noPct!: number | null;

  /** consent: "이상"/"이하"/"추정" 같은 수식어. */
  @Column({ type: "text", nullable: true })
  qualifier!: string | null;

  /** timeline: 공문 일자(YYYY-MM-DD, 글 작성 연도 기준 추정). */
  @Column({ type: "text", nullable: true })
  docDate!: string | null;

  @Column({ type: Date })
  fetchedAt!: Date;
}
