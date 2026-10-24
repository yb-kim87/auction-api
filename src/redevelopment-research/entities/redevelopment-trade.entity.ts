import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 재개발 구역 안(경계 근처 포함) 국토부 빌라(연립다세대) 실거래 — 최근 1년. 국토부 응답 필드는 전부
 * rawJson에 보존한다. 지번은 카카오 주소검색으로 좌표화해 구역 안 여부를 판정한다. 사용자 요청, 2026-10-24. */
@Entity("redevelopment_trades")
@Index(
  "UQ_redev_trade_natural",
  ["zoneId", "lawdCd", "umdNm", "jibun", "floor", "exclusiveArea", "contractDate", "dealAmountManwon"],
  { unique: true },
)
export class RedevelopmentTrade {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index("IDX_redev_trade_zone")
  zoneId!: string;

  @Column({ type: "text" })
  lawdCd!: string;

  @Column({ type: "text" })
  umdNm!: string;

  @Column({ type: "text" })
  jibun!: string;

  /** 법정동코드 10자리 — 공시가격 매칭(sigunguCd+bjdongCd)용. */
  @Column({ type: "text", nullable: true })
  legalDongCode!: string | null;

  @Column({ type: "text", default: "" })
  buildingName!: string;

  @Column({ type: "int", default: 0 })
  floor!: number;

  @Column({ type: "float" })
  exclusiveArea!: number;

  @Column({ type: "float", nullable: true })
  landArea!: number | null;

  @Column({ type: "int", nullable: true })
  buildYear!: number | null;

  /** 만원. */
  @Column({ type: "int" })
  dealAmountManwon!: number;

  /** YYYY-MM-DD. */
  @Column({ type: "text" })
  contractDate!: string;

  @Column({ type: "text", nullable: true })
  registeredAt!: string | null;

  @Column({ type: "text", nullable: true })
  dealingType!: string | null;

  @Column({ type: "text", nullable: true })
  buyerType!: string | null;

  @Column({ type: "text", nullable: true })
  sellerType!: string | null;

  @Column({ type: "text", nullable: true })
  houseType!: string | null;

  @Column({ type: "boolean", default: false })
  isCancelled!: boolean;

  @Column({ type: "text", nullable: true })
  cancelledAt!: string | null;

  @Column({ type: "float", nullable: true })
  lat!: number | null;

  @Column({ type: "float", nullable: true })
  lng!: number | null;

  /** 구역 경계까지의 거리(m). 0이면 구역 안. */
  @Column({ type: "int", nullable: true })
  distanceToZoneM!: number | null;

  /** 국토부 응답 1건 원본(JSON). */
  @Column({ type: "text" })
  rawJson!: string;

  @Column({ type: Date })
  collectedAt!: Date;
}
