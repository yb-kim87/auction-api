import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";

/** /courses/webinar/join/form(ID/PW 회원가입 폼)으로 들어온 신청자.
 * WebinarKakaoLead(카카오 로그인)와 별개 테이블 — 가입 수단이 다르면
 * 필드 구성도 달라(비밀번호 보유 등) 하나로 합치지 않는다. */
@Entity("webinar_email_leads")
@Unique("UQ_webinar_email_leads_email", ["email"])
export class WebinarEmailLead {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  email!: string;

  /** bcrypt 해시. 평문 저장 금지. */
  @Column({ type: "text" })
  passwordHash!: string;

  @Column({ type: "text" })
  name!: string;

  @Column({ type: "text", default: "" })
  gender!: string;

  @Column({ type: "text" })
  phone!: string;

  @Column({ type: "text", default: "" })
  homepage!: string;

  @Column({ type: "text", default: "" })
  address!: string;

  @Column({ type: "text", default: "" })
  addressDetail!: string;

  @Column({ type: "text", default: "" })
  recommendCode!: string;

  @CreateDateColumn()
  createdAt!: Date;
}
