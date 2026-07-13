import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from "typeorm";

/**
 * 랜딩페이지(아임웹) 방문 시점의 UTM/광고 클릭 정보를 고유 방문키(visitId)로
 * 기록한다. 카카오 소셜 로그인으로 자동 가입되는 구조라 회원가입 폼에 UTM을
 * 실어 보낼 수 없어서, 방문 시 발급한 visitId를 브라우저에 저장해뒀다가
 * 가입완료 페이지에서 "이 visitId가 방금 가입을 완료했다"는 신호를 다시
 * 보내게 한다. 그 신호 시각과 아임웹 API의 join_time을 근접 매칭해 유입
 * 정보를 리드에 연결한다(동일 visitId 기준이라 동시간대 여러 방문이 있어도
 * 서로 섞이지 않음 — 시간매칭 단독 방식보다 정확).
 */
@Entity("kakao_landing_visits")
@Unique("UQ_kakao_landing_visits_visit_id", ["visitId"])
export class KakaoLandingVisit {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "text" })
  visitId!: string;

  @Column({ type: "text", default: "" })
  utmSource!: string;

  @Column({ type: "text", default: "" })
  utmMedium!: string;

  @Column({ type: "text", default: "" })
  utmCampaign!: string;

  @Column({ type: "text", default: "" })
  utmContent!: string;

  @Column({ type: "text", default: "" })
  fbclid!: string;

  @Column({ type: "text", default: "" })
  landingUrl!: string;

  /** 방문 직전 페이지(document.referrer) — 검색엔진, SNS 앱 내 브라우저 등 UTM이
   *  없는 유입 경로를 유추하는 데 참고용으로 쓸 수 있다. */
  @Column({ type: "text", default: "" })
  referrer!: string;

  @Index()
  @Column({ type: Date })
  visitedAt!: Date;

  /** 가입완료 페이지에서 "가입 완료" 신호를 받은 시각(없으면 아직 미가입) */
  @Index()
  @Column({ type: Date, nullable: true })
  signupConfirmedAt!: Date | null;

  /** 이미 리드 매칭에 사용된 방문 기록인지(중복 매칭 방지) */
  @Index()
  @Column({ type: "boolean", default: false })
  matched!: boolean;

  @CreateDateColumn()
  createdAt!: Date;
}
