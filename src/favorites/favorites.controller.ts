import {
  Body,
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
    const items = await this.favoritesService.list(ctx.username);
    return { auctionIds, items };
  }

  /** 이 회원이 이전에 등록한 분류명 목록(관심등록 시 재사용용). */
  @Get("categories")
  async listCategories(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const categories = await this.favoritesService.listCategories(ctx.username);
    return { categories };
  }

  @Post("categories")
  async createCategory(
    @Headers() headers: Record<string, string>,
    @Body() body: { name?: string },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.favoritesService.createCategory(ctx.username, body?.name ?? "");
  }

  @Post(":auctionId")
  async add(
    @Headers() headers: Record<string, string>,
    @Param("auctionId") auctionId: string,
    @Body() body: { category?: string | null },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.favoritesService.add(ctx.username, auctionId, body?.category);
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
