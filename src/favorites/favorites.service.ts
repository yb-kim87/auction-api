import {
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuctionFavorite } from "./auction-favorite.entity";
import { UsersService } from "../users/users.service";

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(AuctionFavorite)
    private readonly favoriteRepo: Repository<AuctionFavorite>,
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

  async add(username: string, auctionId: string) {
    const userId = await this.resolveUserId(username);
    const existing = await this.favoriteRepo.findOne({
      where: { userId, auctionId },
    });
    if (existing) {
      return { ok: true, auctionId, alreadyExists: true };
    }

    await this.favoriteRepo.save(
      this.favoriteRepo.create({ userId, auctionId }),
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
