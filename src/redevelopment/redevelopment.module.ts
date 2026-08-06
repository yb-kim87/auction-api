import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { RedevelopmentZone } from "./entities/redevelopment-zone.entity";
import { RedevelopmentTraceFailure } from "./entities/redevelopment-trace-failure.entity";
import { RedevelopmentController } from "./redevelopment.controller";
import { RedevelopmentService } from "./redevelopment.service";

@Module({
  imports: [TypeOrmModule.forFeature([RedevelopmentZone, RedevelopmentTraceFailure, Auction])],
  controllers: [RedevelopmentController],
  providers: [RedevelopmentService],
})
export class RedevelopmentModule {}
