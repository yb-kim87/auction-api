import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { UserItemAction } from "./user-item-action.entity";
import { UsersService } from "../users/users.service";
import type { LogActionDto } from "./log-action.dto";

const VALID_ACTION_TYPES = new Set([
  "impression",
  "click",
  "detail_view",
  "ai_analysis_click",
  "favorite",
  "dislike",
  "reviewed",
]);

@Injectable()
export class UserActionsService {
  constructor(
    @InjectRepository(UserItemAction)
    private readonly actionRepo: Repository<UserItemAction>,
    private readonly usersService: UsersService,
  ) {}

  private async resolveUserId(username: string): Promise<string> {
    const user = await this.usersService.findByUsername(username);
    if (!user) {
      throw new NotFoundException("회원 정보를 찾을 수 없습니다.");
    }
    return user.id;
  }

  async log(username: string, dto: LogActionDto) {
    const userId = await this.resolveUserId(username);
    const itemId = String(dto.itemId ?? "").trim();
    const actionType = String(dto.actionType ?? "").trim();

    if (!itemId || !VALID_ACTION_TYPES.has(actionType)) {
      return { ok: false as const };
    }

    const durationSeconds =
      dto.durationSeconds != null && Number.isFinite(Number(dto.durationSeconds))
        ? Math.max(0, Math.round(Number(dto.durationSeconds)))
        : null;

    const metadata = dto.metadata != null ? JSON.stringify(dto.metadata) : null;

    await this.actionRepo.save(
      this.actionRepo.create({
        userId,
        itemId,
        actionType,
        durationSeconds,
        metadata,
      }),
    );

    return { ok: true as const };
  }

  async logBatch(username: string, items: LogActionDto[]) {
    const userId = await this.resolveUserId(username);
    const rows = items
      .map((dto) => {
        const itemId = String(dto.itemId ?? "").trim();
        const actionType = String(dto.actionType ?? "").trim();
        if (!itemId || !VALID_ACTION_TYPES.has(actionType)) return null;
        return this.actionRepo.create({
          userId,
          itemId,
          actionType,
          durationSeconds:
            dto.durationSeconds != null && Number.isFinite(Number(dto.durationSeconds))
              ? Math.max(0, Math.round(Number(dto.durationSeconds)))
              : null,
          metadata: dto.metadata != null ? JSON.stringify(dto.metadata) : null,
        });
      })
      .filter((row): row is UserItemAction => row !== null);

    if (rows.length === 0) return { ok: true as const, saved: 0 };
    await this.actionRepo.save(rows);
    return { ok: true as const, saved: rows.length };
  }
}
