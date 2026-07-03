import { Body, Controller, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../../common/auth-context";
import { AuctionItemTagEngineService } from "./auction-item-tag-engine.service";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";

@Controller("ai-platform/tags")
export class TagEngineController {
  constructor(
    private readonly tagEngineService: AuctionItemTagEngineService,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.tagEngineService.list();
  }

  @Get(":itemId")
  async findOne(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagEngineService.findByItemId(itemId);
  }

  @Get(":itemId/history")
  async history(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.historyService.listForItem(itemId, "tag");
  }

  @Post("regenerate")
  async regenerate(
    @Headers() headers: Record<string, string>,
    @Body() body: { itemIds?: string[] },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    const itemIds = body.itemIds && body.itemIds.length > 0 ? body.itemIds : null;
    return this.tagEngineService.regenerateMany(itemIds, {
      changedBy: ctx.username,
      actionType: "regenerate",
    });
  }

  @Patch(":itemId/manual-tags")
  async setManualTags(
    @Headers() headers: Record<string, string>,
    @Param("itemId") itemId: string,
    @Body() body: { manualTags: string[] | null },
  ) {
    const ctx = getAuthContext(headers);
    requireAdmin(ctx);
    return this.tagEngineService.setManualTags(itemId, body.manualTags ?? null, {
      changedBy: ctx.username,
      actionType: "manual_update",
    });
  }
}
