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
import { ResaleMatchService } from "./resale-match.service";

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

  /** 지도 표시용 — listMatches와 같은 대상(1위 후보, 55점 이상)에 캐싱된
   * 좌표(있으면)를 붙여서 반환한다. 좌표가 없는 항목의 실제 지오코딩은
   * 프론트(Vercel, 서울 리전)에서 처리한다 — Railway(해외 리전)가
   * VWorld API에 연결하지 못해(SocketError/UND_ERR_SOCKET, 실측
   * 2026-08-04) 백엔드에서 직접 호출하면 항상 실패한다(VAT 계산기와
   * 동일 이슈, 2026-07-21). 사용자 요청, 2026-08-04: "매도분석된
   * 리스트를 지도위에 표시". */
  @Get("matches/map")
  async listMatchesForMap(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const rows = await this.matchRepo.query(`
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
    return { items: rows };
  }

  /** 프론트(Vercel)에서 VWorld로 직접 지오코딩한 결과를 캐싱용으로
   * 저장한다. 주소가 안 바뀌는 한 재조회할 필요 없어 auctions 테이블에
   * 영구 저장(vatPnu 등과 동일 패턴). */
  @Post("matches/coords")
  async saveCoords(
    @Headers() headers: Record<string, string>,
    @Body() body: { items?: Array<{ auctionId?: string; latitude?: number; longitude?: number }> },
  ) {
    requireAdmin(getAuthContext(headers));
    const items = Array.isArray(body.items) ? body.items : [];
    let saved = 0;
    for (const item of items) {
      if (
        !item.auctionId ||
        typeof item.latitude !== "number" ||
        typeof item.longitude !== "number" ||
        !Number.isFinite(item.latitude) ||
        !Number.isFinite(item.longitude)
      ) {
        continue;
      }
      await this.auctionRepo.update(item.auctionId, {
        latitude: item.latitude,
        longitude: item.longitude,
      });
      saved += 1;
    }
    return { ok: true, saved };
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
