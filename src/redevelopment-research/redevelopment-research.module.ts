import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { HousingOfficialPrice } from "../housing-price/entities/housing-official-price.entity";
import { RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { MolitTradeClientService } from "../resale-match/molit-trade-client.service";
import { AddressGeocodeCache } from "./entities/address-geocode-cache.entity";
import { RedevelopmentNaverListing } from "./entities/redevelopment-naver-listing.entity";
import { RedevelopmentResearchRun } from "./entities/redevelopment-research-run.entity";
import { RedevelopmentTrade } from "./entities/redevelopment-trade.entity";
import { RedevelopmentZoneBlogNote } from "./entities/redevelopment-zone-blog-note.entity";
import { ZoneBlogService } from "./zone-blog.service";
import { BuildingRegisterService } from "./building-register.service";
import { AuctionZoneCoordService } from "./auction-zone-coord.service";
import { InterestAuctionAlert } from "./entities/interest-auction-alert.entity";
import { InterestAuctionAlertService } from "./interest-auction-alert.service";
import { ZoneUpdateReminder } from "./entities/zone-update-reminder.entity";
import { RedevelopmentZoneSyncRun } from "./entities/redevelopment-zone-sync-run.entity";
import { RedevelopmentZoneChange } from "./entities/redevelopment-zone-change.entity";
import { RedevelopmentZoneAutoSync } from "./entities/redevelopment-zone-auto-sync.entity";
import { ZoneUpdateReminderService } from "./zone-update-reminder.service";
import { JaegebalZoneSyncService } from "./jaegebal-zone-sync.service";
import { KakaoGeocodeService } from "./kakao-geocode.service";
import { KakaoNotifyModule } from "../kakao-notify/kakao-notify.module";
import { NaverLandService } from "./naver-land.service";
import { RedevelopmentResearchController } from "./redevelopment-research.controller";
import { RedevelopmentResearchService } from "./redevelopment-research.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Auction,
      HousingOfficialPrice,
      RedevelopmentZone,
      RedevelopmentNaverListing,
      RedevelopmentTrade,
      RedevelopmentResearchRun,
      RedevelopmentZoneBlogNote,
      AddressGeocodeCache,
      InterestAuctionAlert,
      ZoneUpdateReminder,
      RedevelopmentZoneSyncRun,
      RedevelopmentZoneChange,
      RedevelopmentZoneAutoSync,
    ]),
    KakaoNotifyModule,
  ],
  controllers: [RedevelopmentResearchController],
  providers: [AuctionZoneCoordService, InterestAuctionAlertService, ZoneUpdateReminderService, JaegebalZoneSyncService, RedevelopmentResearchService, NaverLandService, KakaoGeocodeService, MolitTradeClientService, BuildingRegisterService, ZoneBlogService],
  exports: [AuctionZoneCoordService, InterestAuctionAlertService],
})
export class RedevelopmentResearchModule {}
