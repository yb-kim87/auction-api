import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionsModule } from "./auctions/auctions.module";
import { AuthModule } from "./auth/auth.module";
import { CrawlerModule } from "./crawler/crawler.module";
import { FavoritesModule } from "./favorites/favorites.module";
import { UsersModule } from "./users/users.module";
import { AiModule } from "./ai/ai.module";
import { LoanPolicyModule } from "./loan-policy/loan-policy.module";
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
  ],
})
export class AppModule {}
