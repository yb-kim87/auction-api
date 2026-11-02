import { Body, Controller, Delete, Get, Headers, Param, Put } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { getAuthContext, requireAuth } from "../common/auth-context";
import { AuctionDislike } from "./auction-dislike.entity";

@Controller("dislikes")
export class DislikesController {
  constructor(@InjectRepository(AuctionDislike) private readonly repo: Repository<AuctionDislike>) {}

  /** 내가 싫어요 한 물건 목록(사유 포함). */
  @Get()
  async list(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const rows = await this.repo.find({ where: { userId: ctx.username }, order: { createdAt: "DESC" } });
    return { items: rows.map((r) => ({ auctionId: r.auctionId, reason: r.reason, createdAt: r.createdAt })) };
  }

  /** 싫어요 등록 또는 사유 수정. */
  @Put(":auctionId")
  async set(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body() body: { reason?: string | null },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const reason = body?.reason?.trim() || null;
    const existing = await this.repo.findOne({ where: { userId: ctx.username, auctionId } });
    if (existing) {
      existing.reason = reason;
      await this.repo.save(existing);
    } else {
      await this.repo.save(this.repo.create({ userId: ctx.username, auctionId, reason }));
    }
    return { auctionId, reason };
  }

  @Delete(":auctionId")
  async remove(@Headers() headers: Record<string, string>, @Param("auctionId") auctionId: string) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    await this.repo.delete({ userId: ctx.username, auctionId });
    return { auctionId };
  }
}
