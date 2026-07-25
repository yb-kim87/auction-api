import { Entity, PrimaryColumn, Column, UpdateDateColumn } from "typeorm";

/** 웨비나/강의 슬라이드 한 장. content는 슬라이드 종류별로 자유 형식 텍스트 필드를
 *  담는 JSON(예: { title: "...", subtitle: "..." }). 프론트엔드가 슬라이드 id로
 *  어떤 필드를 렌더링할지 알고 있으므로 스키마리스로 둔다. */
@Entity("lecture_slides")
export class LectureSlide {
  /** 슬라이드 고유 키. 예: "webinar-2607_slide-01". */
  @PrimaryColumn()
  id!: string;

  /** 같은 강의자료(슬라이드 덱)를 묶는 키. 예: "webinar-2607". */
  @Column()
  deckId!: string;

  /** 덱 내 순서(0부터). */
  @Column({ type: "integer", default: 0 })
  sortOrder!: number;

  /** 관리자 화면에 표시할 슬라이드 이름. 예: "01. 표지". */
  @Column()
  label!: string;

  /** simple-json: sqljs(로컬 개발)와 postgres(운영) 양쪽에서 동작하는 타입.
   *  postgres 전용 jsonb는 sqljs가 지원하지 않아 부팅 자체가 실패했었다. */
  @Column({ type: "simple-json" })
  content!: Record<string, string>;

  /** 필드별 위치/스타일. key는 content와 동일한 필드 키.
   *  예: { titleLine1: { top: 425, left: 0, fontSize: 139, color: "#ffffff" } }.
   *  값이 없는 필드는 프론트엔드의 기본 레이아웃(SLIDE_FIELD_DEFS 초기값)을 사용한다. */
  @Column({ type: "simple-json", nullable: true })
  layout!: Record<string, FieldLayout> | null;

  /** 관리자가 붙여넣기/업로드로 추가한 자유위치 이미지 목록.
   *  SLIDE_IMAGES(코드에 하드코딩된 원본 복원 이미지)와 별개로, 슬라이드마다
   *  관리자가 임의로 얹는 이미지를 담는다. */
  @Column({ type: "simple-json", nullable: true })
  images!: ImagePlacement[] | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}

export interface FieldLayout {
  top: number;
  left: number;
  fontSize: number;
  color?: string;
  fontWeight?: number;
  textAlign?: "left" | "center" | "right";
  backgroundColor?: string;
}

export interface ImagePlacement {
  id: string;
  src: string;
  top: number;
  left: number;
  width: number;
}
