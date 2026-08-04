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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
