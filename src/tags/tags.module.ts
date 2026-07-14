import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { TagRule } from "./tag-rule.entity";
import { Auction } from "../auctions/auction.entity";
import { TagsService } from "./tags.service";
import { TagsController } from "./tags.controller";
import { RuleEngineService } from "./rule-engine.service";

@Module({
  imports: [TypeOrmModule.forFeature([TagRule, Auction])],
  providers: [TagsService, RuleEngineService],
  controllers: [TagsController],
  exports: [TagsService, RuleEngineService],
})
export class TagsModule {}
