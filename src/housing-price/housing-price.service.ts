import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { HousingOfficialPrice } from "./entities/housing-official-price.entity";

export type HousingOfficialPriceRow = {
  housingLedgerPk: string | null;
  sigunguCd: string;
  bjdongCd: string;
  mainBun: string;
  subBun: string;
  complexNm: string | null;
  dongNm: string;
  hoNm: string;
  exclusiveArea: number | null;
  postedPrice: number;
  stdYear: string;
};

@Injectable()
export class HousingPriceService {
  constructor(
    @InjectRepository(HousingOfficialPrice)
    private readonly repo: Repository<HousingOfficialPrice>,
  ) {}

  /** 국토부 CSV 배치 임포트용 대량 upsert.
   *
   * housingLedgerPk가 있는 행은 (housingLedgerPk, hoNm, stdYear)로,
   * 없는 행(2024년 이전분 등)은 PK가 없어 유니크 제약이 안 걸리므로
   * 그냥 insert한다 — 재적재 시 중복이 생길 수 있음을 감수한다(오래된
   * 연도는 참고용일 뿐, 대출 판정에는 최신 연도만 쓰기 때문에 실질적
   * 영향이 없다). */
  async bulkUpsert(rows: HousingOfficialPriceRow[]): Promise<{ inserted: number }> {
    if (rows.length === 0) return { inserted: 0 };
    const importedAt = new Date().toISOString();
    const withPk = rows.filter((r) => r.housingLedgerPk);
    const withoutPk = rows.filter((r) => !r.housingLedgerPk);

    if (withPk.length > 0) {
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(HousingOfficialPrice)
        .values(withPk.map((r) => ({ ...r, importedAt })))
        .orUpdate(
          ["sigunguCd", "bjdongCd", "mainBun", "subBun", "complexNm", "exclusiveArea", "postedPrice", "importedAt"],
          ["housingLedgerPk", "hoNm", "stdYear"],
          { skipUpdateIfNoValuesChanged: true },
        )
        .execute();
    }
    if (withoutPk.length > 0) {
      await this.repo.insert(withoutPk.map((r) => ({ ...r, importedAt })));
    }
    return { inserted: rows.length };
  }

  /** 물건의 housingLedgerPk(+동)와 호수로 최신 연도 공시가격을 찾는다.
   * 여러 연도가 있으면 최신 연도를 쓴다. */
  async findLatestByLedgerPk(
    housingLedgerPk: string,
    hoNm: string,
  ): Promise<HousingOfficialPrice | null> {
    return this.repo.findOne({
      where: { housingLedgerPk, hoNm },
      order: { stdYear: "DESC" },
    });
  }
}
