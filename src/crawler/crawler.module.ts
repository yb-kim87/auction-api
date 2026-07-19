import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionsModule } from "../auctions/auctions.module";
import { AiModule } from "../ai/ai.module";
import { CrawlerTelegramService } from "./crawler-algorithm.service";
import { CrawlerConfigRow } from "./crawler-config.entity";
import { CrawlerController } from "./crawler.controller";
import { CrawlerService } from "./crawler.service";

@Module({
  imports: [AuctionsModule, AiModule, TypeOrmModule.forFeature([CrawlerConfigRow])],
  controllers: [CrawlerController],
  providers: [CrawlerService, CrawlerTelegramService],
})
export class CrawlerModule {}
