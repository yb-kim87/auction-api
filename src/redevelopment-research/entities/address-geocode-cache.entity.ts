import { Column, Entity, PrimaryColumn } from "typeorm";

/** 주소 → 좌표 변환 결과 캐시. 같은 지번을 다시 변환하지 않도록 영구 저장한다(주소가 안 바뀌는 한 재조회 불필요).
 * failed=true는 카카오가 "결과 없음"이라고 확정 응답한 주소 — 네트워크 오류는 캐시하지 않는다. */
@Entity("address_geocode_cache")
export class AddressGeocodeCache {
  @PrimaryColumn({ type: "text" })
  address!: string;

  @Column({ type: "float", nullable: true })
  lat!: number | null;

  @Column({ type: "float", nullable: true })
  lng!: number | null;

  /** 법정동코드 10자리(카카오 b_code). */
  @Column({ type: "text", nullable: true })
  legalDongCode!: string | null;

  @Column({ type: "boolean", default: false })
  failed!: boolean;

  @Column({ type: Date })
  createdAt!: Date;
}
