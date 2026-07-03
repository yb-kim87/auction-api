import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AiPlatformHistory } from "./ai-platform-history.entity";
import type { AiPlatformActionType, AiPlatformEngineType } from "../types/common.types";

@Injectable()
export class AiPlatformHistoryService {
  constructor(
    @InjectRepository(AiPlatformHistory)
    private readonly historyRepo: Repository<AiPlatformHistory>,
  ) {}

  async record(input: {
    itemId: string;
    engineType: AiPlatformEngineType;
    actionType: AiPlatformActionType;
    beforeData: object | null;
    afterData: object;
    changedBy: string;
  }) {
    await this.historyRepo.save(
      this.historyRepo.create({
        itemId: input.itemId,
        engineType: input.engineType,
        actionType: input.actionType,
        beforeData: input.beforeData != null ? JSON.stringify(input.beforeData) : null,
        afterData: JSON.stringify(input.afterData),
        changedBy: input.changedBy,
      }),
    );
  }

  async listForItem(itemId: string, engineType: AiPlatformEngineType) {
    return this.historyRepo.find({
      where: { itemId, engineType },
      order: { createdAt: "DESC" },
    });
  }
}
