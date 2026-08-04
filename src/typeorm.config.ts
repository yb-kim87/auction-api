import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { Auction } from "./auctions/auction.entity";
import { AuctionChangeLog } from "./auctions/auction-change.entity";
import { AuctionFavorite } from "./favorites/auction-favorite.entity";
import { FavoriteCategory } from "./favorites/favorite-category.entity";
import { User } from "./users/user.entity";
import { AuctionAnalysis } from "./ai/auction-analysis.entity";
import { AuctionKnowledge } from "./ai/knowledge.entity";
import { KnowledgeCategory } from "./ai/knowledge-category.entity";
import { KnowledgeDraft } from "./ai/knowledge-draft.entity";
import { RightsAnalysisRule } from "./ai/rights-rule.entity";
import { LoanPolicy } from "./loan-policy/loan-policy.entity";
import { LoanSettings } from "./loan-policy/loan-settings.entity";
import { RegulatedRegion } from "./loan-policy/regulated-region.entity";
import { UserItemAction } from "./user-actions/user-item-action.entity";
import { ItemNormalizedData } from "./ai-platform/normalizer/item-normalized-data.entity";
import { ItemAiFeature } from "./ai-platform/feature-engine/item-ai-feature.entity";
import { ItemAiTag } from "./ai-platform/tag-engine/item-ai-tag.entity";
import { AiPlatformHistory } from "./ai-platform/shared/ai-platform-history.entity";
import { KakaoLead } from "./kakao-notify/kakao-lead.entity";
import { KakaoDispatchLog } from "./kakao-notify/kakao-dispatch-log.entity";
import { KakaoSyncState } from "./kakao-notify/kakao-sync-state.entity";
import { KakaoNotifySetting } from "./kakao-notify/kakao-notify-setting.entity";
import { KakaoScheduledDispatch } from "./kakao-notify/kakao-scheduled-dispatch.entity";
import { KakaoAdCreative } from "./kakao-notify/kakao-ad-creative.entity";
import { KakaoLandingVisit } from "./kakao-notify/kakao-landing-visit.entity";
import { TagRule } from "./tags/tag-rule.entity";
import { StrategyRule } from "./tags/strategy-rule.entity";
import { StrategyLabel } from "./tags/strategy-label.entity";
import { SecurityLogIpExclusion } from "./security-log/security-log-ip-exclusion.entity";
import { RequestLog } from "./security-log/request-log.entity";
import { CrawlerConfigRow } from "./crawler/crawler-config.entity";
import { CrawlerLogRow } from "./crawler/crawler-log.entity";
import { LectureSlide } from "./lecture-materials/lecture-slide.entity";
import { ActualTradeRow } from "./resale-match/entities/actual-trade.entity";
import { AuctionTradeMatchRow } from "./resale-match/entities/auction-trade-match.entity";
import { AuctionBidPlan } from "./bid-plan/bid-plan.entity";
import { Course } from "./lecture-replay/entities/course.entity";
import { CourseSection } from "./lecture-replay/entities/course-section.entity";
import { CourseVideo } from "./lecture-replay/entities/course-video.entity";
import { LectureAccessLink } from "./lecture-replay/entities/lecture-access-link.entity";
import { LectureEnrollment } from "./lecture-replay/entities/lecture-enrollment.entity";
import { LectureProgress } from "./lecture-replay/entities/lecture-progress.entity";
import { LectureQuestion } from "./lecture-replay/entities/lecture-question.entity";
import { LectureNote } from "./lecture-replay/entities/lecture-note.entity";
import { RedevelopmentZone } from "./redevelopment/entities/redevelopment-zone.entity";

const entities = [
  Auction,
  AuctionChangeLog,
  AuctionFavorite,
  FavoriteCategory,
  User,
  AuctionAnalysis,
  AuctionKnowledge,
  KnowledgeCategory,
  KnowledgeDraft,
  RightsAnalysisRule,
  LoanPolicy,
  LoanSettings,
  RegulatedRegion,
  UserItemAction,
  ItemNormalizedData,
  ItemAiFeature,
  ItemAiTag,
  AiPlatformHistory,
  KakaoLead,
  KakaoDispatchLog,
  KakaoSyncState,
  KakaoNotifySetting,
  KakaoScheduledDispatch,
  KakaoAdCreative,
  KakaoLandingVisit,
  TagRule,
  StrategyRule,
  StrategyLabel,
  SecurityLogIpExclusion,
  RequestLog,
  CrawlerConfigRow,
  CrawlerLogRow,
  LectureSlide,
  ActualTradeRow,
  AuctionTradeMatchRow,
  AuctionBidPlan,
  Course,
  CourseSection,
  CourseVideo,
  LectureAccessLink,
  LectureEnrollment,
  LectureProgress,
  LectureQuestion,
  LectureNote,
  RedevelopmentZone,
];

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    console.log(
      "[DB] PostgreSQL (DATABASE_URL) synchronize=false, migrationsRun=true",
    );
    return {
      type: "postgres",
      url: databaseUrl,
      ssl:
        process.env.PGSSL === "false"
          ? false
          : { rejectUnauthorized: false },
      entities,
      synchronize: false,
      migrations: [join(__dirname, "migrations", "*.{js,ts}")],
      migrationsRun: true,
    };
  }

  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  console.log("[DB] sql.js local file (data/auction.db)");
  return {
    type: "sqljs",
    location: join(dataDir, "auction.db"),
    autoSave: true,
    entities,
    synchronize: true,
  };
}
