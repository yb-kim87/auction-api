import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { AuctionTradeMatchRow } from "./entities/auction-trade-match.entity";
import { GeocodeService } from "./geocode.service";
import { ResaleMatchService } from "./resale-match.service";

/** 지오코딩 API(VWorld) 호출 부하를 제한하기 위한 동시 실행 수. */
const GEOCODE_CONCURRENCY = 5;
/** 한 번의 지도 조회 요청에서 새로 지오코딩할 최대 건수 — 좌표가 없는
 * 물건이 한꺼번에 수백 건이어도 요청이 과도하게 오래 걸리지 않게 상한을
 * 둔다. 남은 건은 다음 조회(새로고침) 때 이어서 채워진다. */
const GEOCODE_BATCH_LIMIT = 80;

/** 2단계 — 관리자 QA 화면(설계 문서 9.5절)이 쓰는 조회/검토 API.
 * 설계상 55점(MEDIUM) 이상 후보를 QA 대상으로 삼는다 — 70점 이상
 * 이면서 애매하지 않은 것만 사용자 화면(3단계, 아직 미구현)에 노출. */
@Controller("resale-match")
export class ResaleMatchController {
  constructor(
    @InjectRepository(AuctionTradeMatchRow)
    private readonly matchRepo: Repository<AuctionTradeMatchRow>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly resaleMatchService: ResaleMatchService,
    private readonly geocodeService: GeocodeService,
  ) {}

  @Get("auctions/:auctionId/candidates")
  async listCandidates(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.matchRepo.find({
      where: { auctionId },
      order: { candidateRank: "ASC" },
    });
  }

  /** 물건별 1위 후보 중 QA 대상(MEDIUM 이상, 55점~) 목록. */
  @Get("matches")
  async listMatches(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const rows = await this.matchRepo.query(`
      SELECT
        m.id AS "matchId",
        m."auctionId",
        m."scoreTotal",
        m."confidenceTier",
        m."isDisplayed",
        m."isPreCompletion",
        m.status,
        m."reviewedBy",
        m."reviewedAt",
        m."computedAt",
        m2."scoreTotal" AS "runnerUpScore",
        a."auctionNo",
        a.court,
        a."propType",
        a.address,
        a.city,
        a.district,
        a."paymentCompletedAt",
        a."salePrice",
        t."aptNm",
        t."houseType",
        t."buildingDong",
        t."landArea",
        t."umdNm",
        t.jibun,
        t.floor,
        t."exclusiveArea",
        t."dealAmount",
        t."contractDate",
        t."registeredAt"
      FROM auction_trade_match m
      JOIN auctions a ON a.id = m."auctionId"
      JOIN actual_trade t ON t.id = m."actualTradeId"
      LEFT JOIN auction_trade_match m2
        ON m2."auctionId" = m."auctionId" AND m2."candidateRank" = 2
      WHERE m."candidateRank" = 1 AND m."scoreTotal" >= 55
      ORDER BY m."scoreTotal" DESC
    `);
    return rows.map((row: Record<string, unknown>) => {
      const top = Number(row.scoreTotal);
      const runnerUp = row.runnerUpScore == null ? null : Number(row.runnerUpScore);
      return {
        ...row,
        ambiguous: runnerUp != null && top - runnerUp < 8,
      };
    });
  }

  /** 지도 표시용 — listMatches와 같은 대상(1위 후보, 55점 이상)에 좌표를
   * 붙여서 반환한다. 좌표가 없는 물건은 그 자리에서 지오코딩해 채우고
   * auctions 테이블에 캐싱한다(주소가 안 바뀌는 한 재조회 안 함). 사용자
   * 요청, 2026-08-04: "매도분석된 리스트를 지도위에 표시". */
  @Get("matches/map")
  async listMatchesForMap(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const rows: Array<Record<string, unknown>> = await this.matchRepo.query(`
      SELECT
        m.id AS "matchId",
        m."auctionId",
        m."scoreTotal",
        m."confidenceTier",
        m."isDisplayed",
        m.status,
        a."auctionNo",
        a."propType",
        a.address,
        a.city,
        a.district,
        a."umdNm",
        a.jibun,
        a."salePrice",
        a.latitude,
        a.longitude,
        t."dealAmount",
        t."contractDate"
      FROM auction_trade_match m
      JOIN auctions a ON a.id = m."auctionId"
      JOIN actual_trade t ON t.id = m."actualTradeId"
      WHERE m."candidateRank" = 1 AND m."scoreTotal" >= 55
      ORDER BY m."scoreTotal" DESC
    `);

    const missing = rows.filter((r) => r.latitude == null || r.longitude == null).slice(0, GEOCODE_BATCH_LIMIT);
    let geocodedCount = 0;
    for (let i = 0; i < missing.length; i += GEOCODE_CONCURRENCY) {
      const batch = missing.slice(i, i + GEOCODE_CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          const address = [row.city, row.district, row.umdNm, row.jibun]
            .filter((v) => typeof v === "string" && v.trim())
            .join(" ");
          if (!address) return;
          const coord = await this.geocodeService.geocode(address);
          if (!coord) return;
          row.latitude = coord.latitude;
          row.longitude = coord.longitude;
          geocodedCount += 1;
          await this.auctionRepo.update(row.auctionId as string, {
            latitude: coord.latitude,
            longitude: coord.longitude,
          });
        }),
      );
    }

    return {
      items: rows,
      geocodedNow: geocodedCount,
      pendingCount: rows.filter((r) => r.latitude == null || r.longitude == null).length,
    };
  }

  @Patch("matches/:matchId/review")
  async reviewMatch(
    @Headers() headers: Record<string, string>,
    @Param("matchId") matchId: string,
    @Body() body: { status?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    if (body.status !== "CONFIRMED" && body.status !== "REJECTED") {
      throw new BadRequestException("status는 CONFIRMED 또는 REJECTED여야 합니다.");
    }
    await this.matchRepo.update(matchId, {
      status: body.status,
      reviewedBy: ctx.username,
      reviewedAt: new Date(),
    });
    return { ok: true };
  }

  /** 물건작업 화면(검색 페이지)에서 필터링된 물건 ID 목록을 그대로
   * 받아, 그중 낙찰된 물건들이 실제로 매도로 이어졌는지 통계를 낸다
   * (사용자 요청 2026-08-01). */
  @Post("sold-stats")
  async getSoldStats(
    @Headers() headers: Record<string, string>,
    @Body() body: { auctionIds?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    const auctionIds = Array.isArray(body.auctionIds)
      ? body.auctionIds.filter((id) => typeof id === "string" && id.trim())
      : [];
    return this.resaleMatchService.getResaleStatsForAuctionIds(auctionIds);
  }

  /** 물건작업창에서 "주소 추가"로 가져온 사건번호 목록을 그대로 받아
   * 매도분석한다(auctionId를 아직 모르는 시점이라 사건번호로 조회).
   * 사용자 요청 2026-08-01. */
  @Post("sold-stats-by-case-no")
  async getSoldStatsByCaseNo(
    @Headers() headers: Record<string, string>,
    @Body() body: { auctionNos?: string[] },
  ) {
    requireAdmin(getAuthContext(headers));
    const auctionNos = Array.isArray(body.auctionNos)
      ? body.auctionNos.filter((no) => typeof no === "string" && no.trim())
      : [];
    return this.resaleMatchService.getResaleStatsForAuctionNos(auctionNos);
  }

  @Post("run-now")
  async runNow(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    void this.resaleMatchService.runOnce();
    return { ok: true, message: "매도분석 배치를 백그라운드에서 시작했습니다." };
  }
}
