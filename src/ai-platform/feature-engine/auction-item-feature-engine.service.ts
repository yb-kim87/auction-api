import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ItemAiFeature } from "./item-ai-feature.entity";
import { AuctionItemNormalizerService } from "../normalizer/auction-item-normalizer.service";
import { ItemNormalizedData } from "../normalizer/item-normalized-data.entity";
import { Auction } from "../../auctions/auction.entity";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";
import type {
  AiEngine,
  AiEngineRunContext,
  AiEngineRunResult,
} from "../types/common.types";
import type { NormalizedAuctionData } from "../normalizer/normalized-data.types";
import {
  AREA_TIER_BOUNDS,
  isHousingType,
  PRICE_MERIT_RATIO_THRESHOLD,
  SMALL_PRICE_THRESHOLD_WON,
  type AuctionItemFeatures,
} from "./feature.types";

@Injectable()
export class AuctionItemFeatureEngineService
  implements AiEngine<NormalizedAuctionData, AuctionItemFeatures>
{
  readonly engineType = "feature" as const;

  constructor(
    @InjectRepository(ItemAiFeature)
    private readonly featureRepo: Repository<ItemAiFeature>,
    @InjectRepository(ItemNormalizedData)
    private readonly normalizedRepo: Repository<ItemNormalizedData>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly normalizerService: AuctionItemNormalizerService,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  private compute(normalized: NormalizedAuctionData): {
    data: AuctionItemFeatures;
    sources: Record<string, unknown>;
  } {
    const sources: Record<string, unknown> = {};

    const priceTier =
      normalized.minPriceWon > 0 && normalized.minPriceWon <= SMALL_PRICE_THRESHOLD_WON
        ? ("소액물건" as const)
        : null;
    if (priceTier) {
      sources.priceTier = `최저가 ${normalized.minPriceWon.toLocaleString("ko-KR")}원 <= ${SMALL_PRICE_THRESHOLD_WON.toLocaleString("ko-KR")}원 기준`;
    }

    let areaTier: AuctionItemFeatures["areaTier"] = null;
    if (normalized.areaPyeong != null) {
      if (normalized.areaPyeong <= AREA_TIER_BOUNDS.smallMax) areaTier = "소형평형";
      else if (normalized.areaPyeong <= AREA_TIER_BOUNDS.midMax) areaTier = "중형평형";
      else areaTier = "대형평형";
      sources.areaTier = `면적 ${normalized.areaPyeong}평 → ${areaTier} (기준: ~${AREA_TIER_BOUNDS.smallMax}평/~${AREA_TIER_BOUNDS.midMax}평)`;
    }

    const housingType = isHousingType(normalized.propertyType)
      ? ("공동주택" as const)
      : null;
    if (housingType) {
      sources.housingType = `propertyType=${normalized.propertyType}`;
    }

    const priceMerit =
      normalized.minPriceToAppraisedRatio != null &&
      normalized.minPriceToAppraisedRatio <= PRICE_MERIT_RATIO_THRESHOLD;
    if (priceMerit) {
      sources.priceMerit = `감정가 대비 최저가 비율 ${normalized.minPriceToAppraisedRatio}% <= ${PRICE_MERIT_RATIO_THRESHOLD}% 기준`;
    }

    const data: AuctionItemFeatures = { priceTier, areaTier, housingType, priceMerit };
    return { data, sources };
  }

  async runForItem(
    itemId: string,
    input: NormalizedAuctionData,
    ctx: AiEngineRunContext,
  ): Promise<AiEngineRunResult<AuctionItemFeatures>> {
    const { data, sources } = this.compute(input);

    const existing = await this.featureRepo.findOne({ where: { itemId } });
    const beforeData = existing ? JSON.parse(existing.features) : null;
    const version = existing ? existing.version + 1 : 1;

    const saved = await this.featureRepo.save(
      this.featureRepo.create({
        id: existing?.id,
        itemId,
        features: JSON.stringify(data),
        featureSources: JSON.stringify(sources),
        version,
      }),
    );

    await this.historyService.record({
      itemId,
      engineType: this.engineType,
      actionType: ctx.actionType,
      beforeData,
      afterData: data,
      changedBy: ctx.changedBy,
    });

    return { itemId, data, sources, version: saved.version };
  }

  /** 정규화 데이터가 없으면 먼저 생성한 뒤(의존성 채움) Feature를 계산한다. */
  private async ensureNormalized(
    itemId: string,
    ctx: AiEngineRunContext,
  ): Promise<NormalizedAuctionData> {
    const row = await this.normalizedRepo.findOne({ where: { itemId } });
    if (row) return JSON.parse(row.normalizedData);

    const result = await this.normalizerService.regenerateForAuctionId(itemId, ctx);
    return result.data;
  }

  async regenerateForItemId(itemId: string, ctx: AiEngineRunContext) {
    const normalized = await this.ensureNormalized(itemId, ctx);
    return this.runForItem(itemId, normalized, ctx);
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
    const row = await this.featureRepo.findOne({ where: { itemId } });
    if (!row) return null;
    return {
      ...row,
      features: JSON.parse(row.features),
      featureSources: JSON.parse(row.featureSources),
    };
  }

  async list() {
    const rows = await this.featureRepo.find({ order: { updatedAt: "DESC" } });
    return rows.map((row) => ({
      ...row,
      features: JSON.parse(row.features),
      featureSources: JSON.parse(row.featureSources),
    }));
  }

  async manualUpdate(
    itemId: string,
    nextData: Partial<AuctionItemFeatures>,
    ctx: AiEngineRunContext,
  ) {
    const existing = await this.featureRepo.findOne({ where: { itemId } });
    if (!existing) {
      throw new NotFoundException("Feature 데이터가 없습니다. 먼저 생성해 주세요.");
    }
    const beforeData = JSON.parse(existing.features);
    const afterData = { ...beforeData, ...nextData };

    existing.features = JSON.stringify(afterData);
    existing.version += 1;
    const saved = await this.featureRepo.save(existing);

    await this.historyService.record({
      itemId,
      engineType: this.engineType,
      actionType: "manual_update",
      beforeData,
      afterData,
      changedBy: ctx.changedBy,
    });

    return { ...saved, features: afterData, featureSources: JSON.parse(saved.featureSources) };
  }
}
