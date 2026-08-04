import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionFavorite } from "./auction-favorite.entity";
import { FavoriteCategory } from "./favorite-category.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(AuctionFavorite)
    private readonly favoriteRepo: Repository<AuctionFavorite>,
    @InjectRepository(FavoriteCategory)
    private readonly categoryRepo: Repository<FavoriteCategory>,
    private readonly usersService: UsersService,
  ) {}

  private async resolveUserId(username: string): Promise<string> {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException("회원 정보를 찾을 수 없습니다.");
    }
    return user.id;
  }

  async listAuctionIds(username: string): Promise<string[]> {
    const userId = await this.resolveUserId(username);
    const rows = await this.favoriteRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    return rows.map((row) => row.auctionId);
  }

  /** 관심등록 목록을 분류(category)까지 포함해 반환한다. */
  async list(username: string): Promise<{ auctionId: string; category: string | null }[]> {
    const userId = await this.resolveUserId(username);
    const rows = await this.favoriteRepo.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });
    return rows.map((row) => ({ auctionId: row.auctionId, category: row.category }));
  }

  /** 이 회원이 이전에 만들어 쓴 분류명 목록(중복 제거, 가나다순). 관심등록
   * 시 매번 새로 타이핑하지 않고 기존 분류 중에서 골라 쓸 수 있게 한다. */
  async listCategories(username: string): Promise<string[]> {
    const userId = await this.resolveUserId(username);
    const [saved, used] = await Promise.all([
      this.categoryRepo.find({ where: { userId }, order: { createdAt: "ASC" } }),
      this.favoriteRepo
        .createQueryBuilder("fav")
        .select("DISTINCT fav.category", "category")
        .where("fav.userId = :userId", { userId })
        .andWhere("fav.category IS NOT NULL")
        .getRawMany<{ category: string }>(),
    ]);
    return Array.from(new Set([...saved.map((row) => row.name), ...used.map((row) => row.category)]))
      .sort((a, b) => a.localeCompare(b, "ko"));
  }

  async createCategory(username: string, name: string): Promise<{ name: string }> {
    const userId = await this.resolveUserId(username);
    const normalized = name.trim();
    if (!normalized) return { name: "" };
    const existing = await this.categoryRepo.findOne({ where: { userId, name: normalized } });
    if (!existing) {
      await this.categoryRepo.save(this.categoryRepo.create({ userId, name: normalized }));
    }
    return { name: normalized };
  }

  async add(username: string, auctionId: string, category?: string | null) {
    const userId = await this.resolveUserId(username);
    const normalizedCategory = category?.trim() || null;
    if (normalizedCategory) await this.createCategory(username, normalizedCategory);
    const existing = await this.favoriteRepo.findOne({
      where: { userId, auctionId },
    });
    if (existing) {
      if (existing.category !== normalizedCategory) {
        existing.category = normalizedCategory;
        await this.favoriteRepo.save(existing);
      }
      return { ok: true, auctionId, alreadyExists: true };
    }

    await this.favoriteRepo.save(
      this.favoriteRepo.create({ userId, auctionId, category: normalizedCategory }),
    );
    return { ok: true, auctionId };
  }

  async remove(username: string, auctionId: string) {
    const userId = await this.resolveUserId(username);
    const result = await this.favoriteRepo.delete({ userId, auctionId });
    if (!result.affected) {
      throw new NotFoundException("관심물건에 등록되어 있지 않습니다.");
    }
    return { ok: true, auctionId };
  }
}
