import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { RedevelopmentZone } from "./entities/redevelopment-zone.entity";
import { RedevelopmentController } from "./redevelopment.controller";
import { RedevelopmentService } from "./redevelopment.service";

@Module({
  imports: [TypeOrmModule.forFeature([RedevelopmentZone, Auction])],
  controllers: [RedevelopmentController],
  providers: [RedevelopmentService],
})
export class RedevelopmentModule {}
