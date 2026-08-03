import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

const bigintNumberTransformer = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value == null ? value : Number(value)),
};

/** 낙찰물건 매도 추정 기능의 정규화된 실거래 기록. 주 소스는 국토교통부
 * 공식 실거래가 API(RTMSDataSvcAptTrade) — 단지 식별은 단지명(aptNm)
 * 텍스트가 아니라 지번(lawdCd+umdNm+jibun) 기준으로 한다(동명이인 단지
 * 오매칭 방지). 설계: docs/auction-resale-matching-design.md 6.2절. */
@Entity("actual_trade")
@Index("IDX_actual_trade_address", ["lawdCd", "umdNm", "jibun"])
@Index("IDX_actual_trade_naver_complex_area_date", [
  "naverComplexId",
  "exclusiveArea",
  "contractDate",
])
export class ActualTradeRow {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  lawdCd!: string;

  @Column()
  umdNm!: string;

  @Column()
  jibun!: string;

  /** 표시·감사용. 매칭 조건에는 쓰지 않는다(동명이인 위험). */
  @Column()
  aptNm!: string;

  /** 실거래 출처 상품 구분("APT"/"RH"=연립다세대). 매칭 조건에는 쓰지
   * 않지만(지번+층+면적만으로 이미 충분히 좁혀짐) QA 화면에서 이 실거래가
   * 아파트/빌라 어느 API에서 왔는지 확인할 수 있게 태깅한다(2026-08-03,
   * 빌라 매도분석 확장). */
  @Column({ type: "text", nullable: true, default: "APT" })
  houseType!: "APT" | "RH" | null;

  @Column({ type: "text", nullable: true })
  naverComplexId!: string | null;

  /** aptDong — 2024년 이후 계약만 부분 채움(실측 50~75%), 그 외 null. */
  @Column({ type: "text", nullable: true })
  buildingDong!: string | null;

  @Column({ type: "integer", nullable: true })
  floor!: number | null;

  @Column({ type: "numeric", precision: 7, scale: 4 })
  exclusiveArea!: number;

  @Column({ type: "text", nullable: true })
  areaTypeLabel!: string | null;

  /** 원 단위(국토부 API는 만원 단위로 내려오므로 파서에서 ×10000 환산). */
  @Column({ type: "bigint", transformer: bigintNumberTransformer })
  dealAmount!: number;

  @Column({ type: "date" })
  contractDate!: string;

  /** rgstDate(등기접수일) — 국토부 API 직접 제공. */
  @Column({ type: "date", nullable: true })
  registeredAt!: string | null;

  @Column({ type: "text", nullable: true })
  buyerType!: string | null;

  @Column({ type: "text", nullable: true })
  sellerType!: string | null;

  @Column({ type: "text", nullable: true })
  dealingType!: string | null;

  /** cdealType(해제사유) 존재 여부 — true면 하드필터에서 후보 제외
   * 대상이지만 감사용으로 행 자체는 보존한다. */
  @Column({ default: false })
  isCancelled!: boolean;

  @Column({ type: "date", nullable: true })
  cancelledAt!: string | null;

  @Column({ default: "MOLIT_API" })
  sourceType!: "MOLIT_API" | "NAVER_TRADE" | "MANUAL";

  /** simple-json은 운영 PostgreSQL과 로컬 sql.js 양쪽에서 동작한다. */
  @Column({ type: "simple-json", nullable: true })
  sourceRaw!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
