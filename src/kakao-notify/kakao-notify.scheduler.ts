import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ImwebSyncService } from "./imweb-sync.service";
import { InstagramSyncService } from "./instagram-sync.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";
import { TelegramAlertService } from "./telegram-alert.service";

const DEFAULT_INTERVAL_MINUTES = 5;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 180;
/** 같은 소스가 연속으로 이 횟수만큼 실패하면 텔레그램으로 알린다. */
const FAILURE_ALERT_THRESHOLD = 3;

const SOURCE_ALERT_LABELS: Record<"imweb" | "instagram", string> = {
  imweb: "아임웹",
  instagram: "인스타",
};

/**
 * 관리자가 관리자 화면에서 ON/OFF와 폴링 간격(분)을 직접 조정하는 자동
 * 발송 스케줄러. 켜져 있으면 설정된 간격마다 아임웹+인스타의 신규 리드를
 * 확인해 자동 발송하고, 꺼져 있으면 아무 동작도 하지 않는다. 상태와
 * 간격은 kakao_sync_state("scheduler" 소스)에 저장해 서버 재시작 후에도
 * 유지된다.
 */
@Injectable()
export class KakaoNotifyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KakaoNotifyScheduler.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly consecutiveFailures = new Map<"imweb" | "instagram", number>();

  constructor(
    private readonly imwebSync: ImwebSyncService,
    private readonly instagramSync: InstagramSyncService,
    private readonly syncStateService: KakaoSyncStateService,
    private readonly telegramAlert: TelegramAlertService,
  ) {}

  async onModuleInit() {
    const { enabled } = await this.getConfig();
    if (enabled) this.startTimer(await this.getIntervalMinutes());
  }

  onModuleDestroy() {
    this.stopTimer();
  }

  private async getConfig(): Promise<{ enabled: boolean; intervalMinutes: number }> {
    const config = await this.syncStateService.getConfig<{
      enabled?: boolean;
      intervalMinutes?: number;
    }>("scheduler");
    return {
      enabled: config.enabled === true,
      intervalMinutes: this.clampInterval(config.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES),
    };
  }

  private clampInterval(minutes: number): number {
    if (!Number.isFinite(minutes)) return DEFAULT_INTERVAL_MINUTES;
    return Math.min(MAX_INTERVAL_MINUTES, Math.max(MIN_INTERVAL_MINUTES, Math.round(minutes)));
  }

  async isEnabled(): Promise<boolean> {
    return (await this.getConfig()).enabled;
  }

  async getIntervalMinutes(): Promise<number> {
    return (await this.getConfig()).intervalMinutes;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    const { intervalMinutes } = await this.getConfig();
    await this.syncStateService.setConfig("scheduler", { enabled, intervalMinutes });
    if (enabled) this.startTimer(intervalMinutes);
    else this.stopTimer();
  }

  /** 간격(분)을 변경한다. 실행 중이면 새 간격으로 타이머를 재시작한다. */
  async setIntervalMinutes(minutes: number): Promise<number> {
    const clamped = this.clampInterval(minutes);
    const { enabled } = await this.getConfig();
    await this.syncStateService.setConfig("scheduler", { enabled, intervalMinutes: clamped });
    if (enabled) {
      this.stopTimer();
      this.startTimer(clamped);
    }
    return clamped;
  }

  private startTimer(intervalMinutes: number) {
    this.stopTimer();
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMinutes * 60_000);
    this.logger.log(`자동발송 스케줄러 시작(${intervalMinutes}분 간격)`);
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
      if (this.consecutiveFailures.get(source)) {
        this.consecutiveFailures.set(source, 0);
        void this.telegramAlert.send(`✅ ${SOURCE_ALERT_LABELS[source]} 자동발송이 다시 정상 작동합니다.`);
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : "알 수 없는 오류";
      this.logger.error(`${source} 자동발송 실패: ${message}`);
      await this.syncStateService.recordRunResult(source, {
        status: "error",
        errorMessage: message,
      });

      const failures = (this.consecutiveFailures.get(source) ?? 0) + 1;
      this.consecutiveFailures.set(source, failures);
      if (failures === FAILURE_ALERT_THRESHOLD) {
        void this.telegramAlert.send(
          `⚠️ ${SOURCE_ALERT_LABELS[source]} 자동발송이 ${failures}회 연속 실패했습니다.\n오류: ${message}`,
        );
      }
    }
  }
}
