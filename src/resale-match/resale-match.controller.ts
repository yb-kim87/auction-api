import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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
        a.address,
        a."paymentCompletedAt",
        a."salePrice",
        t."aptNm",
        t.floor,
        t."exclusiveArea",
        t."dealAmount",
        t."contractDate"
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

  /** 지역/물건종류 필터를 낙찰 완료 물건에 적용해, 그 필터에 걸리는
   * 주소들이 실제로 매도로 이어졌는지 통계를 낸다(물건작업 필터를
   * 낙찰물건에 재활용, 사용자 요청 2026-08-01). */
  @Get("sold-stats")
  async getSoldStats(
    @Headers() headers: Record<string, string>,
    @Query("city") city?: string,
    @Query("district") district?: string,
    @Query("propType") propType?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    const parseMulti = (raw?: string) =>
      raw
        ? raw
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : undefined;
    return this.resaleMatchService.getFilteredResaleStats({
      city: parseMulti(city),
      district: parseMulti(district),
      propType: parseMulti(propType),
    });
  }

  @Post("run-now")
  async runNow(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    void this.resaleMatchService.runOnce();
    return { ok: true, message: "매도분석 배치를 백그라운드에서 시작했습니다." };
  }
}
