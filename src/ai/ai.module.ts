import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Auction } from "../auctions/auction.entity";
import { UsersModule } from "../users/users.module";
import { AuctionAnalysis } from "./auction-analysis.entity";
import { AuctionKnowledge } from "./knowledge.entity";
import { KnowledgeDraft } from "./knowledge-draft.entity";
import { AiAnalysisService } from "./ai-analysis.service";
import { AiAssistantService } from "./ai-assistant.service";
import { AiController } from "./ai.controller";
import { CafeKnowledgeService } from "./cafe-knowledge.service";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiService } from "./openai.service";
import { RecommendationModule } from "../recommendation/recommendation.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Auction,
      AuctionAnalysis,
      AuctionKnowledge,
      KnowledgeDraft,
    ]),
    UsersModule,
    RecommendationModule,
  ],
  controllers: [AiController],
  providers: [
    AiAnalysisService,
    AiAssistantService,
    KnowledgeService,
    CafeKnowledgeService,
    OpenAiService,
  ],
  exports: [CafeKnowledgeService, KnowledgeService],
})
export class AiModule {}
