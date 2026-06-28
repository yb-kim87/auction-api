import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "./auction.entity";
import { AuctionChangeLog } from "./auction-change.entity";
import { AuctionsController } from "./auctions.controller";
import { AuctionsService } from "./auctions.service";

@Module({
  imports: [TypeOrmModule.forFeature([Auction, AuctionChangeLog])],
  controllers: [AuctionsController],
  providers: [AuctionsService],
  exports: [AuctionsService],
})
export class AuctionsModule {}
