import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { Auction } from "./auctions/auction.entity";
import { AuctionChangeLog } from "./auctions/auction-change.entity";
import { AuctionFavorite } from "./favorites/auction-favorite.entity";
import { User } from "./users/user.entity";
import { AuctionAnalysis } from "./ai/auction-analysis.entity";
import { AuctionKnowledge } from "./ai/knowledge.entity";
import { KnowledgeDraft } from "./ai/knowledge-draft.entity";
import { LoanPolicy } from "./loan-policy/loan-policy.entity";

const entities = [
  Auction,
  AuctionChangeLog,
  AuctionFavorite,
  User,
  AuctionAnalysis,
  AuctionKnowledge,
  KnowledgeDraft,
  LoanPolicy,
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
