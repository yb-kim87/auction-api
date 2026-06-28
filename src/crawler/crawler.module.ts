import { Module } from "@nestjs/common";
import { AuctionsModule } from "../auctions/auctions.module";
import { CrawlerTelegramService } from "./crawler-algorithm.service";
import { CrawlerController } from "./crawler.controller";
import { CrawlerService } from "./crawler.service";

@Module({
  imports: [AuctionsModule],
  controllers: [CrawlerController],
  providers: [CrawlerService, CrawlerTelegramService],
})
export class CrawlerModule {}
