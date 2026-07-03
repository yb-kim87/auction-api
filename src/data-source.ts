import "reflect-metadata";
import { DataSource } from "typeorm";
import { Auction } from "./auctions/auction.entity";
import { AuctionChangeLog } from "./auctions/auction-change.entity";
import { AuctionFavorite } from "./favorites/auction-favorite.entity";
import { User } from "./users/user.entity";
import { AuctionAnalysis } from "./ai/auction-analysis.entity";
import { AuctionKnowledge } from "./ai/knowledge.entity";
import { KnowledgeDraft } from "./ai/knowledge-draft.entity";
import { LoanPolicy } from "./loan-policy/loan-policy.entity";

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
    User,
    AuctionAnalysis,
    AuctionKnowledge,
    KnowledgeDraft,
    LoanPolicy,
  ],
  migrations: ["src/migrations/*.ts"],
  synchronize: false,
});
