import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../../auctions/auction.entity";
import { ItemAiTag } from "./item-ai-tag.entity";
import { ItemAiFeature } from "../feature-engine/item-ai-feature.entity";
import { AuctionItemTagEngineService } from "./auction-item-tag-engine.service";
import { TagEngineController } from "./tag-engine.controller";
import { AiPlatformSharedModule } from "../shared/ai-platform-shared.module";
import { FeatureEngineModule } from "../feature-engine/feature-engine.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Auction, ItemAiTag, ItemAiFeature]),
    AiPlatformSharedModule,
    FeatureEngineModule,
  ],
  controllers: [TagEngineController],
  providers: [AuctionItemTagEngineService],
  exports: [AuctionItemTagEngineService],
})
export class TagEngineModule {}
