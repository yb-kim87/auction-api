import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../../auctions/auction.entity";
import { ItemAiFeature } from "./item-ai-feature.entity";
import { ItemNormalizedData } from "../normalizer/item-normalized-data.entity";
import { AuctionItemFeatureEngineService } from "./auction-item-feature-engine.service";
import { FeatureEngineController } from "./feature-engine.controller";
import { AiPlatformSharedModule } from "../shared/ai-platform-shared.module";
import { NormalizerModule } from "../normalizer/normalizer.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Auction, ItemAiFeature, ItemNormalizedData]),
    AiPlatformSharedModule,
    NormalizerModule,
  ],
  controllers: [FeatureEngineController],
  providers: [AuctionItemFeatureEngineService],
  exports: [AuctionItemFeatureEngineService],
})
export class FeatureEngineModule {}
