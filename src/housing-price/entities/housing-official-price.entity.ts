import { Column, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

/** 국토교통부_주택 공시가격 정보(data.go.kr 3073746) 연 1회 CSV 배치를
 * 그대로 적재한 테이블. 나이스옥션이 공시가격을 매칭하는 방식(2026-08-06
 * 조사: `housePrice.buildingLedgerPk` 필드)을 우리도 직접 재현한다 —
 * 부동산공시가격알리미는 공식 API가 없지만, 국토부가 이 CSV를 통해 같은
 * 원본 데이터를 무료·비로그인으로 전국 단위 배포한다.
 *
 * 갱신 주기가 연 1회(공시기준일 매년 1월 1일)라 실시간 API가 아니라
 * 배치 임포트 방식으로 관리한다(`crawler/import_housing_official_price.py`).
 * 같은 (housingLedgerPk, hoNm, stdYear) 조합이 재적재되면 upsert한다. */
@Entity("housing_official_price")
@Index("IDX_housing_price_ledger_ho", ["housingLedgerPk", "hoNm"])
@Index(
  "UQ_housing_price_ledger_ho_year",
  ["housingLedgerPk", "hoNm", "stdYear"],
  { unique: true, where: '"housingLedgerPk" IS NOT NULL' },
)
export class HousingOfficialPrice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 관리건축물대장PK — 2024년분부터 제공. 이게 없는 옛 연도 행은 아래
   * 주소 기반 필드로만 매칭해야 한다. */
  @Column({ type: "text", nullable: true })
  housingLedgerPk!: string | null;

  @Column({ type: "text", default: "" })
  sigunguCd!: string;

  @Column({ type: "text", default: "" })
  bjdongCd!: string;

  @Column({ type: "text", default: "" })
  mainBun!: string;

  @Column({ type: "text", default: "" })
  subBun!: string;

  @Column({ type: "text", nullable: true })
  complexNm!: string | null;

  @Column({ type: "text", default: "" })
  dongNm!: string;

  @Column({ type: "text", default: "" })
  hoNm!: string;

  @Column({ type: "real", nullable: true })
  exclusiveArea!: number | null;

  /** 공시가격(원). */
  @Column({ type: "bigint" })
  postedPrice!: number;

  /** 공시기준연도(예: "2026"). */
  @Column({ type: "text" })
  stdYear!: string;

  @Column({ type: "text", nullable: true })
  importedAt!: string | null;
}
