import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";
import { BidPlanService } from "./bid-plan.service";

@Controller("bid-plans")
export class BidPlanController {
  constructor(private readonly bidPlanService: BidPlanService) {}

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.bidPlanService.findMine(ctx.username);
  }

  /** 코치(관리자) 전용 — 과제 검토 화면에서 제출자의 저장된 입찰계획
   * 상세(계산기 전체 입력값 포함)를 보기 위해 사용(사용자 요청,
   * 2026-08-07: "제출된 과제는 관리자(코치)한테는 어떻게 보여? 입찰계획
   * 까지 보이나??"). 소유자 제한 없이 임의 username을 조회한다. */
  @Get("coach/:username/:auctionId")
  async getForCoach(
    @Headers() headers: Record<string, string>,
    @Param("username") username: string,
    @Param("auctionId") auctionId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.bidPlanService.findOne(username, auctionId);
  }

  @Get(":auctionId")
  async getOne(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.bidPlanService.findOne(ctx.username, auctionId);
  }

  @Post(":auctionId")
  async save(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body()
    body: {
      bidPrice?: number;
      salePrice?: number;
      finalProfit?: number | null;
      requiredEquity?: number | null;
      memo?: string;
      inputs?: Record<string, unknown>;
    },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.bidPlanService.save(ctx.username, auctionId, {
      bidPrice: Number(body.bidPrice) || 0,
      salePrice: Number(body.salePrice) || 0,
      finalProfit: body.finalProfit == null ? null : Number(body.finalProfit),
      requiredEquity: body.requiredEquity == null ? null : Number(body.requiredEquity),
      memo: body.memo ?? "",
      inputs: body.inputs ?? {},
    });
  }

  @Delete(":auctionId")
  async remove(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.bidPlanService.remove(ctx.username, auctionId);
  }
}
