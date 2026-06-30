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

const entities = [
  Auction,
  AuctionChangeLog,
  AuctionFavorite,
  User,
  AuctionAnalysis,
  AuctionKnowledge,
  KnowledgeDraft,
];

function resolveSynchronize(databaseUrl: string | undefined): boolean {
  if (!databaseUrl) {
    return true;
  }
  return process.env.TYPEORM_SYNCHRONIZE === "true";
}

function isManagedDeploy(): boolean {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
      process.env.RAILWAY_SERVICE_ID ||
      process.env.RAILWAY_PROJECT_ID ||
      process.env.NODE_ENV === "production",
  );
}

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const synchronize = resolveSynchronize(databaseUrl);

  if (!databaseUrl && isManagedDeploy()) {
    throw new Error(
      "[DB] DATABASE_URL이 없습니다. Railway/Vercel 등 운영 환경에서는 Postgres 연결이 필수입니다. " +
        "DATABASE_URL 없이 기동하면 sql.js 임시 파일을 쓰며 재배포마다 데이터가 사라집니다.",
    );
  }

  if (databaseUrl) {
    console.log(
      `[DB] PostgreSQL (DATABASE_URL) synchronize=${synchronize}`,
    );
    if (!synchronize) {
      console.log(
        "[DB] 운영 DB 스키마 자동 변경 비활성 — TYPEORM_SYNCHRONIZE=true 로만 켭니다.",
      );
    }
    return {
      type: "postgres",
      url: databaseUrl,
      ssl:
        process.env.PGSSL === "false"
          ? false
          : { rejectUnauthorized: false },
      entities,
      synchronize,
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
