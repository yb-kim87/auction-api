import { Body, Controller, Delete, Get, Headers, Param, Post } from "@nestjs/common";
import { getAuthContext, requireAuth } from "../common/auth-context";
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
