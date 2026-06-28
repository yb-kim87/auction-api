import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { TypeOrmModuleOptions } from "@nestjs/typeorm";
import { Auction } from "./auctions/auction.entity";
import { AuctionChangeLog } from "./auctions/auction-change.entity";
import { AuctionFavorite } from "./favorites/auction-favorite.entity";
import { User } from "./users/user.entity";

const entities = [Auction, AuctionChangeLog, AuctionFavorite, User];

export function buildTypeOrmConfig(): TypeOrmModuleOptions {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (databaseUrl) {
    return {
      type: "postgres",
      url: databaseUrl,
      ssl:
        process.env.PGSSL === "false"
          ? false
          : { rejectUnauthorized: false },
      entities,
      synchronize: true,
    };
  }

  const dataDir = join(process.cwd(), "data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    type: "sqljs",
    location: join(dataDir, "auction.db"),
    autoSave: true,
    entities,
    synchronize: true,
  };
}
