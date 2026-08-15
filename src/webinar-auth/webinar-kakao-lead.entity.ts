import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** /courses/webinar(무료 웨비나 신청) 페이지에서 카카오 로그인으로 들어온
 * 신청자. kakao-notify 모듈의 KakaoLead(아임웹/인스타 리드 동기화 전용)와는
 * 완전히 별개 — 코치픽 자체 도메인에서 직접 카카오 OAuth를 처리해 받는다. */
@Entity("webinar_kakao_leads")
@Unique("UQ_webinar_kakao_leads_kakao_id", ["kakaoId"])
export class WebinarKakaoLead {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  kakaoId!: string;

  @Column({ type: "text", default: "" })
  nickname!: string;

  @Column({ type: "text", default: "" })
  email!: string;

  @Column({ type: "text", default: "" })
  phone!: string;

  @Column({ type: "text", default: "" })
  profileImageUrl!: string;

  /** 카카오 토큰 응답/사용자 정보 응답 전체(JSON 문자열, 디버깅·재처리용) */
  @Column({ type: "text", default: "" })
  rawPayload!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
