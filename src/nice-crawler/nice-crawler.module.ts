import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionsModule } from "../auctions/auctions.module";
import { NiceCrawlerLogRow } from "./entities/nice-crawler-log.entity";
import { NiceCrawlerStateRow } from "./entities/nice-crawler-state.entity";
import { NiceSavedSearchRow } from "./entities/nice-saved-search.entity";
import { NiceCrawlerController } from "./nice-crawler.controller";
import { NiceCrawlerService } from "./nice-crawler.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([NiceCrawlerStateRow, NiceCrawlerLogRow, NiceSavedSearchRow]),
    AuctionsModule,
  ],
  controllers: [NiceCrawlerController],
  providers: [NiceCrawlerService],
})
export class NiceCrawlerModule {}
