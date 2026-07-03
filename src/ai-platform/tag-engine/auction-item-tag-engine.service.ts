import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ItemAiTag } from "./item-ai-tag.entity";
import { ItemAiFeature } from "../feature-engine/item-ai-feature.entity";
import { AuctionItemFeatureEngineService } from "../feature-engine/auction-item-feature-engine.service";
import { Auction } from "../../auctions/auction.entity";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";
import type {
  AiEngine,
  AiEngineRunContext,
  AiEngineRunResult,
} from "../types/common.types";
import type { AuctionItemFeatures } from "../feature-engine/feature.types";
import { RULE_BASED_CONFIDENCE, type TagEngineOutput } from "./tag.types";

@Injectable()
export class AuctionItemTagEngineService
  implements AiEngine<AuctionItemFeatures, TagEngineOutput>
{
  readonly engineType = "tag" as const;

  constructor(
    @InjectRepository(ItemAiTag)
    private readonly tagRepo: Repository<ItemAiTag>,
    @InjectRepository(ItemAiFeature)
    private readonly featureRepo: Repository<ItemAiFeature>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly featureEngineService: AuctionItemFeatureEngineService,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  /** 규칙 기반 Feature → Tag 매핑. 새 규칙은 이 배열에만 추가하면 된다. */
  private computeAutoTags(features: AuctionItemFeatures): TagEngineOutput {
    const autoTags: string[] = [];
    const sources: Record<string, string> = {};

    if (features.priceTier === "소액물건") {
      autoTags.push("소액투자");
      sources["소액투자"] = "feature.priceTier = 소액물건";
    }
    if (features.housingType === "공동주택") {
      autoTags.push("실거주검토가능");
      sources["실거주검토가능"] = "feature.housingType = 공동주택";
    }
    if (features.priceMerit) {
      autoTags.push("가격메리트검토");
      sources["가격메리트검토"] = "feature.priceMerit = true";
    }
    if (features.areaTier === "대형평형") {
      autoTags.push("대형평형검토");
      sources["대형평형검토"] = "feature.areaTier = 대형평형";
    }

    return { autoTags, sources };
  }

  private resolveFinalTags(autoTags: string[], manualTags: string[] | null): string[] {
    return manualTags != null ? manualTags : autoTags;
  }

  async runForItem(
    itemId: string,
    input: AuctionItemFeatures,
    ctx: AiEngineRunContext,
  ): Promise<AiEngineRunResult<TagEngineOutput & { finalTags: string[] }>> {
    const { autoTags, sources } = this.computeAutoTags(input);

    const existing = await this.tagRepo.findOne({ where: { itemId } });
    const manualTags: string[] | null = existing?.manualTags
      ? JSON.parse(existing.manualTags)
      : null;
    const finalTags = this.resolveFinalTags(autoTags, manualTags);

    const beforeData = existing
      ? {
          autoTags: JSON.parse(existing.autoTags),
          manualTags,
          finalTags: JSON.parse(existing.finalTags),
        }
      : null;
    const version = existing ? existing.version + 1 : 1;

    const saved = await this.tagRepo.save(
      this.tagRepo.create({
        id: existing?.id,
        itemId,
        autoTags: JSON.stringify(autoTags),
        manualTags: existing?.manualTags ?? null,
        finalTags: JSON.stringify(finalTags),
        tagSources: JSON.stringify(sources),
        confidence: RULE_BASED_CONFIDENCE,
        version,
      }),
    );

    const afterData = { autoTags, manualTags, finalTags };
    await this.historyService.record({
      itemId,
      engineType: this.engineType,
      actionType: ctx.actionType,
      beforeData,
      afterData,
      changedBy: ctx.changedBy,
    });

    return {
      itemId,
      data: { autoTags, sources, finalTags },
      sources,
      version: saved.version,
    };
  }

  private async ensureFeatures(
    itemId: string,
    ctx: AiEngineRunContext,
  ): Promise<AuctionItemFeatures> {
    const row = await this.featureRepo.findOne({ where: { itemId } });
    if (row) return JSON.parse(row.features);

    const result = await this.featureEngineService.regenerateForItemId(itemId, ctx);
    return result.data;
  }

  async regenerateForItemId(itemId: string, ctx: AiEngineRunContext) {
    const features = await this.ensureFeatures(itemId, ctx);
    return this.runForItem(itemId, features, ctx);
  }

  async regenerateMany(itemIds: string[] | null, ctx: AiEngineRunContext) {
    const targets = itemIds
      ? itemIds
      : (await this.auctionRepo.find()).map((row) => row.id);

    const results = [];
    for (const itemId of targets) {
      results.push(await this.regenerateForItemId(itemId, ctx));
    }
    return { count: results.length };
  }

  async findByItemId(itemId: string) {
    const row = await this.tagRepo.findOne({ where: { itemId } });
    if (!row) return null;
    return {
      ...row,
      autoTags: JSON.parse(row.autoTags),
      manualTags: row.manualTags ? JSON.parse(row.manualTags) : null,
      finalTags: JSON.parse(row.finalTags),
      tagSources: JSON.parse(row.tagSources),
    };
  }

  async list() {
    const rows = await this.tagRepo.find({ order: { updatedAt: "DESC" } });
    return rows.map((row) => ({
      ...row,
      autoTags: JSON.parse(row.autoTags),
      manualTags: row.manualTags ? JSON.parse(row.manualTags) : null,
      finalTags: JSON.parse(row.finalTags),
      tagSources: JSON.parse(row.tagSources),
    }));
  }

  /** 관리자가 manual_tags를 직접 지정 — 있으면 항상 final_tags보다 우선한다. */
  async setManualTags(itemId: string, manualTags: string[] | null, ctx: AiEngineRunContext) {
    const existing = await this.tagRepo.findOne({ where: { itemId } });
    if (!existing) {
      throw new NotFoundException("Tag 데이터가 없습니다. 먼저 생성해 주세요.");
    }
    const autoTags: string[] = JSON.parse(existing.autoTags);
    const beforeData = {
      autoTags,
      manualTags: existing.manualTags ? JSON.parse(existing.manualTags) : null,
      finalTags: JSON.parse(existing.finalTags),
    };
    const finalTags = this.resolveFinalTags(autoTags, manualTags);

    existing.manualTags = manualTags != null ? JSON.stringify(manualTags) : null;
    existing.finalTags = JSON.stringify(finalTags);
    existing.version += 1;
    const saved = await this.tagRepo.save(existing);

    const afterData = { autoTags, manualTags, finalTags };
    await this.historyService.record({
      itemId,
      engineType: this.engineType,
      actionType: "manual_update",
      beforeData,
      afterData,
      changedBy: ctx.changedBy,
    });

    return {
      ...saved,
      autoTags,
      manualTags,
      finalTags,
      tagSources: JSON.parse(saved.tagSources),
    };
  }
}
