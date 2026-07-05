import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { ItemAiTag } from "../ai-platform/tag-engine/item-ai-tag.entity";
import { UsersModule } from "../users/users.module";
import { LoanPolicyModule } from "../loan-policy/loan-policy.module";
import { RecommendationEngineService } from "./recommendation-engine.service";
import { RecommendationController } from "./recommendation.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Auction, ItemAiTag]),
    UsersModule,
    LoanPolicyModule,
  ],
  controllers: [RecommendationController],
  providers: [RecommendationEngineService],
  exports: [RecommendationEngineService],
})
export class RecommendationModule {}
