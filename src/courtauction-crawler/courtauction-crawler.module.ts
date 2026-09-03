import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionsModule } from "../auctions/auctions.module";
import { CourtAuctionCrawlerLogRow } from "./entities/courtauction-crawler-log.entity";
import { CourtAuctionCrawlerStateRow } from "./entities/courtauction-crawler-state.entity";
import { CourtAuctionSavedSearchRow } from "./entities/courtauction-saved-search.entity";
import { CourtAuctionCrawlerController } from "./courtauction-crawler.controller";
import { CourtAuctionCrawlerService } from "./courtauction-crawler.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([CourtAuctionCrawlerStateRow, CourtAuctionCrawlerLogRow, CourtAuctionSavedSearchRow]),
    AuctionsModule,
  ],
  controllers: [CourtAuctionCrawlerController],
  providers: [CourtAuctionCrawlerService],
})
export class CourtAuctionCrawlerModule {}
