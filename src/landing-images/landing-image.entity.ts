import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 강의실 메인(/courses) 소개 페이지에 쓰이는 이미지 슬롯 하나.
 * id는 슬라이드 코드에서 쓰는 고정 슬롯 키(예: "hero", "logo")이고,
 * imageUrl은 관리자 페이지에서 업로드하거나 직접 입력한 URL이다.
 * 슬롯이 늘어나면 LANDING_IMAGE_SLOTS(landing-images.constants.ts)에
 * 키를 추가하기만 하면 되고, 컬럼을 늘릴 필요는 없다(key-value 구조). */
@Entity("landing_images")
export class LandingImageRow {
  @PrimaryColumn()
  id!: string;

  @Column({ type: "varchar", nullable: true })
  imageUrl!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
