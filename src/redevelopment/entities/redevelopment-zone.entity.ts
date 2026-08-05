import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type RedevelopmentPoint = { lat: number; lng: number };

/** 재개발 구역도 — 관리자가 카카오맵 위에서 직접 그린 다각형(꼭짓점
 * 위도·경도 목록)과 구역 정보를 저장한다. 기존 경매물건이 이 구역
 * 안에 포함되는지 판별하는 데 쓴다(사용자 요청, 2026-08-04). */
@Entity("redevelopment_zones")
export class RedevelopmentZone {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ default: "" })
  name!: string;

  @Column({ default: "" })
  region!: string;

  /** 자유 텍스트(예: "구역지정", "조합설립인가", "사업시행인가",
   * "관리처분인가", "이주철거", "착공", "준공") — 단계 값이 지자체/사업장마다
   * 조금씩 다르게 불려 enum으로 고정하지 않는다. */
  @Column({ default: "" })
  stage!: string;

  @Column({ type: "text", nullable: true })
  memo!: string | null;

  /** 다각형 꼭짓점 목록(위도·경도 순서대로) — 최소 3개. */
  @Column({ type: "simple-json" })
  polygon!: RedevelopmentPoint[];

  /** 지도에 표시할 때 쓸 색상(선택, 없으면 프론트가 sortOrder/stage
   * 기준으로 자동 배정). */
  @Column({ type: "text", nullable: true })
  color!: string | null;

  /** 사업유형(재개발/재건축/신속통합기획/모아타운 등) — 자유 텍스트,
   * 원본 데이터 표기가 소스마다 달라 정규화는 프론트/수집 로직에서 처리. */
  @Column({ type: "text", nullable: true })
  projectType!: string | null;

  /** 이 구역을 만든 파이프라인(설계: docs/redevelopment-zone-data-pipeline-design.md §1). */
  @Column({ type: "text", default: "MANUAL" })
  source!: "PUBLIC_GIS" | "PUBLIC_API" | "NOTICE_PDF" | "IMAGE_EXTRACTION" | "MANUAL";

  /** 원본 데이터셋 식별자(예: "seoul-upisRebuild") — 중복판별 키의 일부. */
  @Column({ type: "text", nullable: true })
  sourceDatasetId!: string | null;

  /** 원본 데이터의 고유 식별 키(예: PRJC_CD) — 중복판별 키의 일부.
   * MANUAL 구역은 null로 두며, source/sourceDatasetId/sourceKey가 전부
   * null인 행끼리는 유니크 인덱스에 안 걸린다(Postgres NULL 특성). */
  @Column({ type: "text", nullable: true })
  sourceKey!: string | null;

  /** 원본 데이터 기준일자(고시일 등). */
  @Column({ type: "date", nullable: true })
  asOfDate!: string | null;

  /** 폴리곤이 실제 경계인지, 지오코딩+근사인지, 관리자가 직접 그린 것인지. */
  @Column({ type: "text", default: "MANUAL" })
  boundaryType!: "EXACT" | "CONVEX_HULL_APPROX" | "POINT_ONLY" | "MANUAL";

  /** 자동 수집 파이프라인이 마지막으로 이 구역을 갱신한 시각 — 관리자가
   * MANUAL로 마지막 수정한 뒤에는 자동 갱신이 덮어쓰지 않게 판단하는 데 쓴다. */
  @Column({ type: Date, nullable: true })
  lastAutoSyncedAt!: Date | null;

  /** 원본(지자체 홈페이지 등) 위치도/조감도 이미지 URL — 있으면 "이미지로
   * 구역 그리기" 도구에서 업로드 없이 이 이미지를 바로 불러와 정밀 경계로
   * 보정할 수 있다(사용자 요청, 2026-08-04: "은평구청 데이터를 기반으로
   * 정밀 경계를 통한 구역도 적용해보는거 어때"). */
  @Column({ type: "text", nullable: true })
  referenceImageUrl!: string | null;

  /** 고시 면적(㎡). 원 근사 반지름 계산에도 쓰지만, 이미지에서 자동 추출한
   * 경계가 제대로 잡혔는지 검증하는 기준으로도 쓴다 — 보정된 폴리곤의
   * 실제 면적이 이 값과 크게 다르면 기준점을 잘못 찍은 것이다
   * (사용자 요청, 2026-08-05: 이미지 인식 + 배율 일치화). */
  @Column({ type: "real", nullable: true })
  areaSqMeters!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
