import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionChangeLog } from "../auctions/auction-change.entity";
import { CrawlerLogRow } from "../crawler/crawler-log.entity";
import { KakaoDispatchLog } from "../kakao-notify/kakao-dispatch-log.entity";
import { ActualTradeRow } from "../resale-match/entities/actual-trade.entity";
import { UserItemAction } from "../user-actions/user-item-action.entity";
import { DbRetentionService } from "./db-retention.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ActualTradeRow,
      AuctionChangeLog,
      KakaoDispatchLog,
      UserItemAction,
      CrawlerLogRow,
    ]),
  ],
  providers: [DbRetentionService],
})
export class DbMaintenanceModule {}
