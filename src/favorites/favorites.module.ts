import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UsersModule } from "../users/users.module";
import { AuctionDislike } from "./auction-dislike.entity";
import { AuctionFavorite } from "./auction-favorite.entity";
import { DislikesController } from "./dislikes.controller";
import { FavoriteCategory } from "./favorite-category.entity";
import { FavoritesController } from "./favorites.controller";
import { FavoritesService } from "./favorites.service";

@Module({
  imports: [TypeOrmModule.forFeature([AuctionFavorite, FavoriteCategory, AuctionDislike]), UsersModule],
  controllers: [FavoritesController, DislikesController],
  providers: [FavoritesService],
  exports: [FavoritesService],
})
export class FavoritesModule {}
