import {
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
} from "@nestjs/common";
import {
  getAuthContext,
  requireAuth,
} from "../common/auth-context";
import { FavoritesService } from "./favorites.service";

@Controller("favorites")
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  async list(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const auctionIds = await this.favoritesService.listAuctionIds(ctx.username);
    return { auctionIds };
  }

  @Post(":auctionId")
  async add(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.favoritesService.add(ctx.username, auctionId);
  }

  @Delete(":auctionId")
  async remove(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.favoritesService.remove(ctx.username, auctionId);
  }
}
