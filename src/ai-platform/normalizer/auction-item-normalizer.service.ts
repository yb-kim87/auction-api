import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Auction } from "../../auctions/auction.entity";
import { ItemNormalizedData } from "./item-normalized-data.entity";
import { normalizePropertyType } from "./property-type-alias.util";
import { parseAreaToPyeong } from "./area-parser.util";
import { AiPlatformHistoryService } from "../shared/ai-platform-history.service";
import type {
  AiEngine,
  AiEngineRunContext,
  AiEngineRunResult,
} from "../types/common.types";
import type { NormalizedAuctionData } from "./normalized-data.types";

function computeRatio(minPrice: number, appraisedValue: number): number | null {
  if (!minPrice || !appraisedValue || appraisedValue <= 0) return null;
  return Math.round((minPrice / appraisedValue) * 100);
}

@Injectable()
export class AuctionItemNormalizerService
  implements AiEngine<Auction, NormalizedAuctionData>
{
  readonly engineType = "normalizer" as const;

  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(ItemNormalizedData)
    private readonly normalizedRepo: Repository<ItemNormalizedData>,
    private readonly historyService: AiPlatformHistoryService,
  ) {}

  private compute(auction: Auction): {
    data: NormalizedAuctionData;
    sources: Record<string, unknown>;
  } {
    const sources: Record<string, unknown> = {};

    const propertyType = normalizePropertyType(auction.usage);
    if (propertyType.changed) {
      sources.propertyType = {
        from: auction.usage,
        to: propertyType.value,
        rule: "property-type-alias-map",
      };
    }

    const area = parseAreaToPyeong(auction.area);
    if (area.pyeong != null && area.changed) {
      sources.areaPyeong = {
        from: auction.area,
        to: area.pyeong,
        rule: "sqm-to-pyeong-conversion",
      };
    }

    const ratio = computeRatio(auction.minPrice, auction.appraisedValue);
    if (ratio != null) {
      sources.minPriceToAppraisedRatio = {
        from: { minPrice: auction.minPrice, appraisedValue: auction.appraisedValue },
        to: ratio,
        rule: "round(minPrice / appraisedValue * 100)",
      };
    }

    const data: NormalizedAuctionData = {
      propertyType: propertyType.value,
      city: auction.city,
      district: auction.district,
      minPriceWon: auction.minPrice,
      appraisedValueWon: auction.appraisedValue,
      areaRaw: auction.area,
      areaPyeong: area.pyeong,
      minPriceToAppraisedRatio: ratio,
    };

    return { data, sources };
  }

  async runForItem(
    itemId: string,
    input: Auction,
    ctx: AiEngineRunContext,
  ): Promise<AiEngineRunResult<NormalizedAuctionData>> {
    const { data, sources } = this.compute(input);

    const existing = await this.normalizedRepo.findOne({ where: { itemId } });
    const beforeData = existing ? JSON.parse(existing.normalizedData) : null;
    const version = existing ? existing.version + 1 : 1;

    const saved = await this.normalizedRepo.save(
      this.normalizedRepo.create({
        id: existing?.id,
        itemId,
        normalizedData: JSON.stringify(data),
        normalizedSources: JSON.stringify(sources),
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

  /** 단건 재생성 — Auction을 다시 조회해서 실행 */
  async regenerateForAuctionId(auctionId: string, ctx: AiEngineRunContext) {
    const auction = await this.auctionRepo.findOne({ where: { id: auctionId } });
    if (!auction) {
      throw new NotFoundException("물건을 찾을 수 없습니다.");
    }
    return this.runForItem(auctionId, auction, ctx);
  }

  async regenerateMany(auctionIds: string[] | null, ctx: AiEngineRunContext) {
    const auctions = auctionIds
      ? await this.auctionRepo.find({ where: { id: In(auctionIds) } })
      : await this.auctionRepo.find();

    const results = [];
    for (const auction of auctions) {
      results.push(await this.runForItem(auction.id, auction, ctx));
    }
    return { count: results.length };
  }

  async findByItemId(itemId: string) {
    const row = await this.normalizedRepo.findOne({ where: { itemId } });
    if (!row) return null;
    return {
      ...row,
      normalizedData: JSON.parse(row.normalizedData),
      normalizedSources: JSON.parse(row.normalizedSources),
    };
  }

  async list() {
    const rows = await this.normalizedRepo.find({ order: { updatedAt: "DESC" } });
    return rows.map((row) => ({
      ...row,
      normalizedData: JSON.parse(row.normalizedData),
      normalizedSources: JSON.parse(row.normalizedSources),
    }));
  }

  async manualUpdate(
    itemId: string,
    nextData: Partial<NormalizedAuctionData>,
    ctx: AiEngineRunContext,
  ) {
    const existing = await this.normalizedRepo.findOne({ where: { itemId } });
    if (!existing) {
      throw new NotFoundException("정규화 데이터가 없습니다. 먼저 생성해 주세요.");
    }
    const beforeData = JSON.parse(existing.normalizedData);
    const afterData = { ...beforeData, ...nextData };

    existing.normalizedData = JSON.stringify(afterData);
    existing.version += 1;
    const saved = await this.normalizedRepo.save(existing);

    await this.historyService.record({
      itemId,
      engineType: this.engineType,
      actionType: "manual_update",
      beforeData,
      afterData,
      changedBy: ctx.changedBy,
    });

    return { ...saved, normalizedData: afterData, normalizedSources: JSON.parse(saved.normalizedSources) };
  }
}
