import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TagRule } from "./tag-rule.entity";
import { StrategyRule } from "./strategy-rule.entity";
import { StrategyLabel } from "./strategy-label.entity";
import { Auction } from "../auctions/auction.entity";
import { TagsService } from "./tags.service";
import { TagsController } from "./tags.controller";
import { RuleEngineService } from "./rule-engine.service";

@Module({
  imports: [TypeOrmModule.forFeature([TagRule, StrategyRule, StrategyLabel, Auction])],
  providers: [TagsService, RuleEngineService],
  controllers: [TagsController],
  exports: [TagsService, RuleEngineService],
})
export class TagsModule {}
