import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../../common/auth-context";
import { AuctionItemNormalizerService } from "./auction-item-normalizer.service";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";

@Controller("ai-platform/normalizer")
export class NormalizerController {
  constructor(
    private readonly normalizerService: AuctionItemNormalizerService,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.normalizerService.list();
  }

  @Get(":itemId")
  async findOne(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.normalizerService.findByItemId(itemId);
  }

  @Get(":itemId/history")
  async history(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.historyService.listForItem(itemId, "normalizer");
  }

  @Post("regenerate")
  async regenerate(
    @Headers() headers: Record<string, string>,
    @Body() body: { itemIds?: string[] },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    const itemIds = body.itemIds && body.itemIds.length > 0 ? body.itemIds : null;
    return this.normalizerService.regenerateMany(itemIds, {
      changedBy: ctx.username,
      actionType: "regenerate",
    });
  }

  @Patch(":itemId")
  async update(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.normalizerService.manualUpdate(itemId, body, {
      changedBy: ctx.username,
      actionType: "manual_update",
    });
  }
}
