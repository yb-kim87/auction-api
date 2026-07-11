import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionsModule } from "./auctions/auctions.module";
import { AuthModule } from "./auth/auth.module";
import { CrawlerModule } from "./crawler/crawler.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { UsersModule } from "./users/users.module";
import { AiModule } from "./ai/ai.module";
import { LoanPolicyModule } from "./loan-policy/loan-policy.module";
import { UserActionsModule } from "./user-actions/user-actions.module";
import { AiPlatformModule } from "./ai-platform/ai-platform.module";
import { RecommendationModule } from "./recommendation/recommendation.module";
import { KakaoNotifyModule } from "./kakao-notify/kakao-notify.module";
import { buildTypeOrmConfig } from "./typeorm.config";

@Module({
  imports: [
    TypeOrmModule.forRoot(buildTypeOrmConfig()),
    AuctionsModule,
    AuthModule,
    CrawlerModule,
    FavoritesModule,
    UsersModule,
    AiModule,
    LoanPolicyModule,
    UserActionsModule,
    AiPlatformModule,
    RecommendationModule,
    KakaoNotifyModule,
  ],
})
export class AppModule {}
