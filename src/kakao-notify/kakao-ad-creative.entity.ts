import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Unique } from "typeorm";

/**
 * 유입소재(adName) 문자열에 참고용 이미지/영상을 매핑해두는 테이블.
 * 목록에서 소재명에 마우스를 올렸을 때 미리보기로 보여주기 위함이며,
 * 발송 로직과는 무관한 순수 관리용 메타데이터다.
 */
@Entity("kakao_ad_creatives")
@Unique("UQ_kakao_ad_creatives_ad_name", ["adName"])
export class KakaoAdCreative {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  adName!: string;

  /** 관리자가 지정한 표시명(예: "이미지_10"). 유입소재(adName) 등록 시에는
   *  비워두고 목록에 adName 원본을 그대로 쓰며, utm_content(소재ID) 등록
   *  시에만 사용해 원본 숫자 ID 대신 이 이름으로 표시한다. */
  @Column({ type: "text", default: "" })
  label!: string;

  /** 이미지/영상 URL(외부 CDN 또는 업로드된 파일 경로) */
  @Column({ type: "text" })
  mediaUrl!: string;

  @Column({ type: "text", default: "image" })
  mediaType!: "image" | "video";

  @CreateDateColumn()
  createdAt!: Date;
}
