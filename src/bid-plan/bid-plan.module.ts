import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionBidPlan } from "./bid-plan.entity";
import { Auction } from "../auctions/auction.entity";
import { BidPlanController } from "./bid-plan.controller";
import { BidPlanService } from "./bid-plan.service";

@Module({
  imports: [TypeOrmModule.forFeature([AuctionBidPlan, Auction])],
  controllers: [BidPlanController],
  providers: [BidPlanService],
})
export class BidPlanModule {}
