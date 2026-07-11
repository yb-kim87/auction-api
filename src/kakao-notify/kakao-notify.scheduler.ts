import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ImwebSyncService } from "./imweb-sync.service";
import { InstagramSyncService } from "./instagram-sync.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";

const POLL_INTERVAL_MS = 5 * 60_000;

/**
 * 관리자가 관리자 화면에서 ON/OFF로 직접 켜고 끄는 자동 폴링 스케줄러.
 * 켜져 있으면 5분 간격으로 아임웹+인스타의 신규 리드를 확인해 자동
 * 발송하고, 꺼져 있으면 아무 동작도 하지 않는다. ON/OFF 상태는
 * kakao_sync_state("scheduler" 소스)에 저장해 서버 재시작 후에도 유지된다.
 */
@Injectable()
export class KakaoNotifyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KakaoNotifyScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly imwebSync: ImwebSyncService,
    private readonly instagramSync: InstagramSyncService,
    private readonly syncStateService: KakaoSyncStateService,
  ) {}

  async onModuleInit() {
    const enabled = await this.isEnabled();
    if (enabled) this.startTimer();
  }

  onModuleDestroy() {
    this.stopTimer();
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.syncStateService.getConfig<{ enabled?: boolean }>("scheduler");
    return config.enabled === true;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.syncStateService.setConfig("scheduler", { enabled });
    if (enabled) this.startTimer();
    else this.stopTimer();
  }

  private startTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, POLL_INTERVAL_MS);
    this.logger.log("자동발송 스케줄러 시작(5분 간격)");
  }

  private stopTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    this.logger.log("자동발송 스케줄러 중지");
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOne("imweb", () => this.imwebSync.syncNewMembers());
      await this.runOne("instagram", () => this.instagramSync.syncNewRows());
    } finally {
      this.running = false;
    }
  }

  private async runOne(
    source: "imweb" | "instagram",
    run: () => Promise<{ processed: number; created: number }>,
  ): Promise<{ processed: number; created: number } | void> {
    try {
      const result = await run();
      this.logger.log(`${source} 자동발송: ${result.processed}건 확인, ${result.created}건 신규`);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      this.logger.error(`${source} 자동발송 실패: ${message}`);
      await this.syncStateService.recordRunResult(source, {
        status: "error",
        errorMessage: message,
      });
    }
  }
}
