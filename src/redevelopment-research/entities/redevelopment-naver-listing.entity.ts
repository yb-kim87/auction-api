import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 재개발 구역 안(경계 근처 포함) 네이버 부동산 빌라 매매 매물. samsam 프로젝트의 NaverVillaListing 구조를
 * 따라 목록 원본(rawListJson)과 상세 원본(rawDetailJson)을 통째로 저장한다 — 네이버를 다시 부르지 않고
 * 저장된 원본으로 재필터/재분석하기 위함(samsam CLAUDE.md 규칙 3). 사용자 요청, 2026-10-24. */
@Entity("redevelopment_naver_listings")
@Index("UQ_redev_naver_listing_zone_article", ["zoneId", "articleNo"], { unique: true })
export class RedevelopmentNaverListing {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index("IDX_redev_naver_listing_zone")
  zoneId!: string;

  @Column({ type: "text" })
  articleNo!: string;

  /** 네이버 동 코드(법정동 10자리). */
  @Column({ type: "text", default: "" })
  cortarNo!: string;

  @Column({ type: "text", nullable: true })
  tradeType!: string | null;

  @Column({ type: "text", nullable: true })
  typeName!: string | null;

  @Column({ type: "text", nullable: true })
  articleName!: string | null;

  /** 네이버 원본 가격 표기("1억 5,000"). */
  @Column({ type: "text", nullable: true })
  priceText!: string | null;

  /** 만원 단위. */
  @Column({ type: "int", nullable: true })
  priceManwon!: number | null;

  @Column({ type: "float", nullable: true })
  supplyArea!: number | null;

  @Column({ type: "float", nullable: true })
  exclusiveArea!: number | null;

  @Column({ type: "int", nullable: true })
  roomCount!: number | null;

  @Column({ type: "text", nullable: true })
  floorInfo!: string | null;

  @Column({ type: "text", nullable: true })
  direction!: string | null;

  @Column({ type: "text", nullable: true })
  confirmedAt!: string | null;

  @Column({ type: "text", nullable: true })
  feature!: string | null;

  @Column({ type: "text", nullable: true })
  realtor!: string | null;

  @Column({ type: "text", nullable: true })
  realtorPhone!: string | null;

  @Column({ type: "float", nullable: true })
  lat!: number | null;

  @Column({ type: "float", nullable: true })
  lng!: number | null;

  /** 구역 경계까지의 거리(m). 0이면 구역 안. 저장 대상은 이 값이 MAX 오차범위 이내인 매물뿐. */
  @Column({ type: "int", nullable: true })
  distanceToZoneM!: number | null;

  /** 상세 API의 주소(exposureAddress 등). */
  @Column({ type: "text", nullable: true })
  address!: string | null;

  /** 좌표 → 지번 주소 변환 결과(공시가 매칭용) — 메인/서브 번지. */
  @Column({ type: "text", nullable: true })
  jibun!: string | null;

  @Column({ type: "text", nullable: true })
  legalDongCode!: string | null;

  @Column({ type: "int", nullable: true })
  buildingYear!: number | null;

  @Column({ type: "text", nullable: true })
  useApprovalDate!: string | null;

  /** "15년이내" 같은 목록 연식 대략치. */
  @Column({ type: "text", nullable: true })
  ageTag!: string | null;

  /** 필지고유번호 19자리(법정동코드 10 + 대지구분 1 + 본번 4 + 부번 4) — 상세 응답에서만. */
  @Column({ type: "text", nullable: true })
  pnu!: string | null;

  /** 현재 전세 보증금(만원, articlePrice.allWarrantPrice) — 매매가 − 이 값 = 실제 갭. */
  @Column({ type: "int", nullable: true })
  warrantPriceManwon!: number | null;

  @Column({ type: "int", nullable: true })
  bathroomCount!: number | null;

  @Column({ type: "int", nullable: true })
  householdCount!: number | null;

  @Column({ type: "int", nullable: true })
  parkingCount!: number | null;

  @Column({ type: "int", nullable: true })
  subwayWalkMin!: number | null;

  @Column({ type: "text", nullable: true })
  lawUsage!: string | null;

  @Column({ type: "text", nullable: true })
  heatMethod!: string | null;

  /** fin.land 단지 식별자와 단지정보(네이버 "단지정보" 탭) — 정확한 지번·도로명·사용승인일 등. 같은 단지는 한 번만 조회해 재사용한다. */
  @Column({ type: "int", nullable: true })
  complexNumber!: number | null;

  @Column({ type: "text", nullable: true })
  complexName!: string | null;

  @Column({ type: "text", nullable: true })
  roadAddress!: string | null;

  @Column({ type: "int", nullable: true })
  totalHouseholdNumber!: number | null;

  @Column({ type: "text", nullable: true })
  constructionCompany!: string | null;

  @Column({ type: "float", nullable: true })
  floorAreaRatio!: number | null;

  @Column({ type: "float", nullable: true })
  buildingCoverageRatio!: number | null;

  @Column({ type: "int", nullable: true })
  elevatorCount!: number | null;

  @Column({ type: "int", nullable: true })
  totalParkingCount!: number | null;

  @Column({ type: "int", nullable: true })
  approvalElapsedYear!: number | null;

  /** 단지정보 응답 원본(JSON). */
  @Column({ type: "text", nullable: true })
  complexInfoJson!: string | null;

  /** 건축물대장 표제부 대지면적(㎡) — 호별 대지지분 추정(대지면적 × 전용면적 / 건물 전용합)에 쓴다. 0 또는 null이면 계산 불가. */
  @Column({ type: "float", nullable: true })
  platArea!: number | null;

  /** 건축물대장 조회를 마친 시각(값이 없어도 기록해 다시 부르지 않는다). */
  @Column({ type: Date, nullable: true })
  platAreaFetchedAt!: Date | null;

  /** fin.land 단지 조회를 마친 시각 — 이미 상세 수집이 끝난 매물도 단지정보만 보충하기 위한 표시. */
  @Column({ type: Date, nullable: true })
  finFetchedAt!: Date | null;

  @Column({ type: "float", nullable: true })
  adminCostManwon!: number | null;

  @Column({ type: "text", nullable: true })
  adminCostMemo!: string | null;

  @Column({ type: "text", nullable: true })
  moveInText!: string | null;

  @Column({ type: "text", nullable: true })
  featureDesc!: string | null;

  @Column({ type: "text", nullable: true })
  introText!: string | null;

  @Column({ type: "text", nullable: true })
  photoUrlsJson!: string | null;

  /** 목록 API 원본(매물 1건 JSON). */
  @Column({ type: "text" })
  rawListJson!: string;

  /** 상세 API 원본(전체 JSON). 상세 조회 전에는 null. */
  @Column({ type: "text", nullable: true })
  rawDetailJson!: string | null;

  @Column({ type: Date, nullable: true })
  detailFetchedAt!: Date | null;

  @Column({ type: Date })
  firstSeenAt!: Date;

  @Column({ type: Date })
  lastSeenAt!: Date;

  /** 수집 완료된 실행에서 목록에 안 나온 횟수 — 2 이상이면 내려간 매물로 보고 숨긴다. */
  @Column({ type: "int", default: 0 })
  missCount!: number;
}
