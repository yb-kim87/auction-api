import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

/** 재개발닷컴 구(시군구 코드)별 조회 범위(bbox) 캐시 — 구 경계는 거의 바뀌지 않아 한 번만 받아 두고,
 * 구역도 업데이트는 이 범위로 구역 목록만 1회 요청한다(경계 요청·30초 대기 생략, 사용자 요청 2026-11-07). */
@Entity("redevelopment_district_bbox")
export class RedevelopmentDistrictBbox {
  @PrimaryColumn({ type: "varchar" })
  code!: string;

  @Column({ type: "double precision" })
  minLat!: number;

  @Column({ type: "double precision" })
  maxLat!: number;

  @Column({ type: "double precision" })
  minLng!: number;

  @Column({ type: "double precision" })
  maxLng!: number;

  @UpdateDateColumn()
  updatedAt!: Date;
}
