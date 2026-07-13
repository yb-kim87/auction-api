import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";

export type KakaoLeadSource = "imweb" | "instagram";
export type KakaoLeadStatus =
  | "pending"
  | "sent"
  | "failed"
  | "skipped_duplicate";

@Entity("kakao_leads")
@Unique("UQ_kakao_leads_source_ref", ["source", "sourceRefId"])
@Unique("UQ_kakao_leads_source_phone", ["source", "phone"])
export class KakaoLead {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Index()
  @Column({ type: "text" })
  source!: KakaoLeadSource;

  @Column({ type: "text" })
  sourceRefId!: string;

  @Column({ type: "text", default: "" })
  name!: string;

  @Column({ type: "text" })
  phone!: string;

  @Column({ type: "text", default: "" })
  email!: string;

  @Column({ type: "text", default: "" })
  gender!: string;

  @Column({ type: "text", default: "" })
  birthDate!: string;

  @Column({ type: "text", default: "" })
  address!: string;

  /** 인스타그램 인스턴트 폼의 유입소재(광고명) */
  @Column({ type: "text", default: "" })
  adName!: string;

  /** 원본 시스템에서의 가입/신청 시각(가입시간 컬럼) */
  @Column({ type: Date, nullable: true })
  joinedAt!: Date | null;

  /** 원본 API/시트 응답 전체(JSON 문자열, 디버깅·재처리용) */
  @Column({ type: "text", default: "" })
  rawPayload!: string;

  @Index()
  @Column({ type: "text", default: "pending" })
  status!: KakaoLeadStatus;

  /** 관리자가 명시적으로 "알림톡 제외" 처리한 고객. 선택 발송(일괄발송) 대상에서만 제외되고
   *  자동발송·개별 재발송은 영향받지 않는다. */
  @Index()
  @Column({ type: "boolean", default: false })
  excludedFromBulk!: boolean;

  /** 관리자가 자유롭게 붙이는 그룹명(예: "2월 세미나"). 목록 필터/일괄 지정용. */
  @Index()
  @Column({ type: "text", default: "" })
  groupLabel!: string;

  /** 카카오 소셜 로그인 자동가입이라 회원가입 폼에 UTM을 실을 수 없어, 랜딩페이지
   *  방문 시각과 가입시각(joinedAt) 근접도로 추정 매칭한 유입 캠페인 정보(참고용). */
  @Column({ type: "text", default: "" })
  utmSource!: string;

  @Column({ type: "text", default: "" })
  utmCampaign!: string;

  @Column({ type: "text", default: "" })
  utmMedium!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
