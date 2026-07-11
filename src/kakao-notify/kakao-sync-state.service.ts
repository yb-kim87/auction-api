import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  KakaoSyncState,
  KakaoSyncSource,
  KakaoSyncRunStatus,
} from "./kakao-sync-state.entity";

@Injectable()
export class KakaoSyncStateService {
  constructor(
    @InjectRepository(KakaoSyncState)
    private readonly repo: Repository<KakaoSyncState>,
  ) {}

  async getOrCreate(source: KakaoSyncSource): Promise<KakaoSyncState> {
    const existing = await this.repo.findOne({ where: { source } });
    if (existing) return existing;
    return this.repo.save(this.repo.create({ source, lastRunStatus: "never_run" }));
  }

  async findAll(): Promise<KakaoSyncState[]> {
    const sources: KakaoSyncSource[] = ["imweb", "instagram"];
    return Promise.all(sources.map((s) => this.getOrCreate(s)));
  }

  async recordRunResult(
    source: KakaoSyncSource,
    result: {
      status: KakaoSyncRunStatus;
      errorMessage?: string | null;
      lastSyncedAt?: Date | null;
      lastCursor?: string | null;
    },
  ) {
    const state = await this.getOrCreate(source);
    state.lastRunAt = new Date();
    state.lastRunStatus = result.status;
    state.lastErrorMessage = result.errorMessage ?? null;
    if (result.lastSyncedAt !== undefined) state.lastSyncedAt = result.lastSyncedAt;
    if (result.lastCursor !== undefined) state.lastCursor = result.lastCursor;
    return this.repo.save(state);
  }

  async getConfig<T extends Record<string, unknown>>(source: KakaoSyncSource): Promise<T> {
    const state = await this.getOrCreate(source);
    try {
      return JSON.parse(state.configJson || "{}") as T;
    } catch {
      return {} as T;
    }
  }

  async setConfig(source: KakaoSyncSource, config: Record<string, unknown>) {
    const state = await this.getOrCreate(source);
    state.configJson = JSON.stringify(config ?? {});
    return this.repo.save(state);
  }
}
