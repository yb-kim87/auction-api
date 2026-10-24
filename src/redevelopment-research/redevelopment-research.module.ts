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
import { KakaoGeocodeService } from "./kakao-geocode.service";
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
      AddressGeocodeCache,
    ]),
  ],
  controllers: [RedevelopmentResearchController],
  providers: [RedevelopmentResearchService, NaverLandService, KakaoGeocodeService, MolitTradeClientService],
})
export class RedevelopmentResearchModule {}
