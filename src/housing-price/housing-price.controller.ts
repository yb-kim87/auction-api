import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { HousingPriceService, type HousingOfficialPriceRow } from "./housing-price.service";

/** 국토부_주택 공시가격 정보(data.go.kr 3073746) 연 1회 CSV 배치를
 * 적재/조회하는 관리자 전용 API. 실시간 API가 아니라 파일 배치라
 * `crawler/import_housing_official_price.py`가 로컬에서 CSV를 파싱해
 * 청크 단위로 이 엔드포인트를 호출한다(사용자 요청, 2026-08-06). */
@Controller("housing-price")
export class HousingPriceController {
  constructor(private readonly service: HousingPriceService) {}

  /** CSV 배치 임포트 — 연 1회, 사람이 로컬에서 스크립트를 돌리는
   * 상황이라 로그인 세션이 아니라 크롤러와 같은 시크릿 헤더로 인증한다
   * (crawler.controller.ts의 x-crawler-secret 패턴과 동일). */
  @Post("import")
  async import(
    @Headers() headers: Record<string, string>,
    @Body() body: { rows: HousingOfficialPriceRow[] },
  ) {
    const secret = headers["x-crawler-secret"] ?? "";
    const expected = process.env.CRAWLER_SECRET ?? "local-crawler-secret";
    if (secret !== expected) {
      throw new ServiceUnavailableException("크롤러 인증 실패");
    }
    return this.service.bulkUpsert(body.rows ?? []);
  }

  @Get("lookup")
  async lookup(
    @Headers() headers: Record<string, string>,
    @Query("housingLedgerPk") housingLedgerPk: string,
    @Query("hoNm") hoNm: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.findLatestByLedgerPk(housingLedgerPk, hoNm);
  }
}
