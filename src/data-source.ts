import "reflect-metadata";
import { DataSource } from "typeorm";
import { Auction } from "./auctions/auction.entity";
import { AuctionChangeLog } from "./auctions/auction-change.entity";
import { AuctionFavorite } from "./favorites/auction-favorite.entity";
import { FavoriteCategory } from "./favorites/favorite-category.entity";
import { User } from "./users/user.entity";
import { AuctionAnalysis } from "./ai/auction-analysis.entity";
import { AuctionKnowledge } from "./ai/knowledge.entity";
import { KnowledgeCategory } from "./ai/knowledge-category.entity";
import { KnowledgeDraft } from "./ai/knowledge-draft.entity";
import { LoanPolicy } from "./loan-policy/loan-policy.entity";
import { LoanSettings } from "./loan-policy/loan-settings.entity";
import { RegulatedRegion } from "./loan-policy/regulated-region.entity";
import { UserItemAction } from "./user-actions/user-item-action.entity";
import { ItemNormalizedData } from "./ai-platform/normalizer/item-normalized-data.entity";
import { ItemAiFeature } from "./ai-platform/feature-engine/item-ai-feature.entity";
import { ItemAiTag } from "./ai-platform/tag-engine/item-ai-tag.entity";
import { AiPlatformHistory } from "./ai-platform/shared/ai-platform-history.entity";
import { TagRule } from "./tags/tag-rule.entity";
import { StrategyRule } from "./tags/strategy-rule.entity";
import { StrategyLabel } from "./tags/strategy-label.entity";
import { CrawlerConfigRow } from "./crawler/crawler-config.entity";

/**
 * TypeORM CLI 전용 (migration:generate / migration:run 등).
 * 앱 실행 시 실제 연결 설정은 typeorm.config.ts를 사용합니다.
 * DATABASE_URL을 운영 Postgres로 지정한 상태에서만 migration:generate를 실행하세요.
 */
export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "false" ? false : { rejectUnauthorized: false },
  entities: [
    Auction,
    AuctionChangeLog,
    AuctionFavorite,
    FavoriteCategory,
    User,
    AuctionAnalysis,
    AuctionKnowledge,
    KnowledgeCategory,
    KnowledgeDraft,
    LoanPolicy,
    LoanSettings,
    RegulatedRegion,
    UserItemAction,
    ItemNormalizedData,
    ItemAiFeature,
    ItemAiTag,
    AiPlatformHistory,
    TagRule,
    StrategyRule,
    StrategyLabel,
    CrawlerConfigRow,
  ],
  migrations: ["src/migrations/*.ts"],
  synchronize: false,
});
