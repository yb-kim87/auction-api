import { Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { AuctionTradeMatchRow } from "./entities/auction-trade-match.entity";
import { ResaleMatchService } from "./resale-match.service";

/** 1단계 범위 — 관리자 QA 화면(설계 문서 9.5절, 2단계)은 아직 없으므로,
 * 결과를 확인할 최소한의 조회 API만 제공한다. */
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

  @Post("run-now")
  async runNow(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    void this.resaleMatchService.runOnce();
    return { ok: true, message: "재판매 매칭 배치를 백그라운드에서 시작했습니다." };
  }
}
