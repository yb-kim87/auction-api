import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
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
import { TagsModule } from "./tags/tags.module";
import { SecurityLogModule } from "./security-log/security-log.module";
import { RequestLogMiddleware } from "./security-log/request-log.middleware";
import { VatModule } from "./vat/vat.module";
import { LectureMaterialsModule } from "./lecture-materials/lecture-materials.module";
import { ResaleMatchModule } from "./resale-match/resale-match.module";
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
    TagsModule,
    SecurityLogModule,
    VatModule,
    LectureMaterialsModule,
    ResaleMatchModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLogMiddleware).forRoutes("*");
  }
}
