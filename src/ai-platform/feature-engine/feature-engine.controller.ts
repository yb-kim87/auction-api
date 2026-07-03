import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../../common/auth-context";
import { AuctionItemFeatureEngineService } from "./auction-item-feature-engine.service";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";

@Controller("ai-platform/features")
export class FeatureEngineController {
  constructor(
    private readonly featureEngineService: AuctionItemFeatureEngineService,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.featureEngineService.list();
  }

  @Get(":itemId")
  async findOne(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.featureEngineService.findByItemId(itemId);
  }

  @Get(":itemId/history")
  async history(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.historyService.listForItem(itemId, "feature");
  }

  @Post("regenerate")
  async regenerate(
    @Headers() headers: Record<string, string>,
    @Body() body: { itemIds?: string[] },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    const itemIds = body.itemIds && body.itemIds.length > 0 ? body.itemIds : null;
    return this.featureEngineService.regenerateMany(itemIds, {
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
    return this.featureEngineService.manualUpdate(itemId, body, {
      changedBy: ctx.username,
      actionType: "manual_update",
    });
  }
}
