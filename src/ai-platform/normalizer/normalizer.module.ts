import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../../auctions/auction.entity";
import { ItemNormalizedData } from "./item-normalized-data.entity";
import { AuctionItemNormalizerService } from "./auction-item-normalizer.service";
import { NormalizerController } from "./normalizer.controller";
import { AiPlatformSharedModule } from "../shared/ai-platform-shared.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Auction, ItemNormalizedData]),
    AiPlatformSharedModule,
  ],
  controllers: [NormalizerController],
  providers: [AuctionItemNormalizerService],
  exports: [AuctionItemNormalizerService],
})
export class NormalizerModule {}
