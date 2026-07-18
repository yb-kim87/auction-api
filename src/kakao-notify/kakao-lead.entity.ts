import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  Unique,
} from "typeorm";

export type KakaoLeadSource = "imweb" | "instagram" | "manual_sheet";
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

  /** source를 더 세분화하는 채널명(수동 리드 시트 전용, 예: "naver폼",
   *  "카카오폼"). 시트의 "저장매체" 컬럼값을 그대로 담는다 — source 자체를
   *  이 값으로 바꾸면 기존 아임웹/인스타 전용 자동발송·설정 로직이 source를
   *  "imweb"|"instagram"으로 가정하는 곳들과 충돌할 위험이 있어, 별도
   *  필드로 분리해 유입경로 필터를 source(대분류)+channel(세부매체)
   *  2단계로 걸 수 있게 한다. */
  @Index()
  @Column({ type: "text", default: "" })
  channel!: string;

  /** 네이버폼 등 설문형 유입 소스(수동 리드 시트 전용)의 질문-응답 전체를
   *  JSON 객체 문자열로 담는다(예: {"나이대":"40대","직업":"자영업", ...}).
   *  질문 구성이 바뀔 수 있어 고정 컬럼 대신 시트 헤더 행을 그대로
   *  키로 사용해, 질문이 추가/삭제돼도 코드 수정 없이 저장할 수 있다. */
  @Column({ type: "text", default: "" })
  surveyAnswers!: string;

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

  /** 광고 소재(크리에이티브) ID(utm_content). 메타 광고에서 캠페인/광고그룹과
   *  별개로 소재 단위 식별자가 여기 담겨 온다. */
  @Column({ type: "text", default: "" })
  utmContent!: string;

  /** 가입완료 페이지의 "카톡방 참여하기" 버튼을 가장 최근에 클릭한 시각(클릭
   *  여부만 확인 가능 — 카카오 오픈채팅 실제 입장 여부는 API로 확인할 수 없는
   *  한계가 있다). 기존 회원이 재방문해 여러 번 클릭하면 매번 갱신된다. */
  @Column({ type: Date, nullable: true })
  kakaoRoomClickedAt!: Date | null;

  /** 카톡방 버튼을 처음 클릭한 시각(최초 1회만 기록, 이후 재클릭에도 변하지 않음) */
  @Column({ type: Date, nullable: true })
  firstKakaoRoomClickedAt!: Date | null;

  /** 카톡방 버튼을 클릭한 총 횟수(재방문 재클릭 포함) */
  @Column({ type: "integer", default: 0 })
  kakaoRoomClickCount!: number;

  /** 이 리드와 매칭된 랜딩 방문의 visitId(정확한 재매칭용, 예: 클릭 이벤트가
   *  매칭 이후에 도착하는 경우). */
  @Index()
  @Column({ type: "text", default: "" })
  visitId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
