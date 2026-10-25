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
    ]),
    KakaoNotifyModule,
  ],
  controllers: [RedevelopmentResearchController],
  providers: [AuctionZoneCoordService, RedevelopmentResearchService, NaverLandService, KakaoGeocodeService, MolitTradeClientService, BuildingRegisterService, ZoneBlogService],
  exports: [AuctionZoneCoordService],
})
export class RedevelopmentResearchModule {}
