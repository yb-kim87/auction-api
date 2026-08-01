import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { ActualTradeRow } from "./entities/actual-trade.entity";
import { AuctionTradeMatchRow } from "./entities/auction-trade-match.entity";
import { MolitTradeClientService } from "./molit-trade-client.service";
import { TradeIngestionService } from "./trade-ingestion.service";
import { ResaleMatchService } from "./resale-match.service";
import { ResaleMatchController } from "./resale-match.controller";

/** 낙찰물건 매도 추정(재판매 매칭) 기능. 설계:
 * docs/auction-resale-matching-design.md. */
@Module({
  imports: [TypeOrmModule.forFeature([Auction, ActualTradeRow, AuctionTradeMatchRow])],
  controllers: [ResaleMatchController],
  providers: [MolitTradeClientService, TradeIngestionService, ResaleMatchService],
  exports: [ResaleMatchService],
})
export class ResaleMatchModule {}
