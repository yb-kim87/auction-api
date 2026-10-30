import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";
import { RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { RedevelopmentZoneSyncRun } from "./entities/redevelopment-zone-sync-run.entity";
import { ZoneUpdateReminder } from "./entities/zone-update-reminder.entity";

const ROW_ID = "jaegebal";
const INTERVAL_DAYS = 14;
const SEND_HOUR_KST = 10;
const TICK_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** 재개발닷컴 구역도는 관리자가 구를 지정해 업데이트하거나(`POST redevelopment-research/jaegebal-sync`), 자동 업데이트를 켜 둔 경우에만 가져온다
 * (사이트 보안 확인 때문에 간격을 크게 둔 최소 수집 원칙, 2026-10-30).
 * 마지막 반영(구역 변경·성공한 업데이트 실행) 또는 마지막 알림에서 2주가 지나면 텔레그램으로 "업데이트가 필요하다"고 알린다(사용자 요청, 2026-10-28).
 * 매일 오전 10시(한국시간)에만 확인하고, 재개발 전용 채널(REDEVELOPMENT_TELEGRAM_CHAT_ID)이 있으면 그쪽으로, 없으면 기본 채널로 보낸다. */
@Injectable()
export class ZoneUpdateReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ZoneUpdateReminderService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;

  constructor(
    @InjectRepository(ZoneUpdateReminder) private readonly reminders: Repository<ZoneUpdateReminder>,
    @InjectRepository(RedevelopmentZone) private readonly zones: Repository<RedevelopmentZone>,
    @InjectRepository(RedevelopmentZoneSyncRun) private readonly syncRuns: Repository<RedevelopmentZoneSyncRun>,
    private readonly telegram: TelegramAlertService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick().catch((e) => this.logger.error(`구역도 업데이트 알림 확인 실패: ${e}`)), TICK_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private kstHour(now: Date): number {
    return new Date(now.getTime() + 9 * 60 * 60_000).getUTCHours();
  }

  async tick(now = new Date()): Promise<void> {
    if (this.busy || this.kstHour(now) !== SEND_HOUR_KST) return;
    this.busy = true;
    try {
      const row = await this.reminders.findOne({ where: { id: ROW_ID } });
      const lastZone = await this.zones
        .createQueryBuilder("z")
        .select("MAX(z.updatedAt)", "max")
        .where("z.sourceDatasetId = :d", { d: "jaegebal" })
        .getRawOne<{ max: Date | string | null }>();
      const lastUpdate = lastZone?.max ? new Date(lastZone.max) : null;
      // 구역이 하나도 안 바뀐 성공 실행(수동·자동)도 "마지막 반영"으로 본다 — 구역 updatedAt은 바뀐 구역에서만 갱신되기 때문.
      const lastRun = await this.syncRuns.findOne({ where: { state: "done" }, order: { startedAt: "DESC" } });
      const lastRunAt = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;
      // 기준 시각 = 마지막 구역 반영·마지막 성공 업데이트·마지막 알림 중 가장 최근 것. 모두 없으면 지금을 기준으로 삼아 2주 뒤에 첫 알림을 보낸다.
      const base = [lastUpdate, lastRunAt, row?.lastSentAt ?? null].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      if (!base) {
        await this.reminders.save({ id: ROW_ID, lastSentAt: now });
        return;
      }
      const days = Math.floor((now.getTime() - base.getTime()) / DAY_MS);
      if (days < INTERVAL_DAYS) return;
      const chat = process.env.REDEVELOPMENT_TELEGRAM_CHAT_ID?.trim() || undefined;
      const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(d) : "기록 없음");
      const text = [
        "🗺️ 재개발닷컴 구역도 업데이트가 필요합니다",
        `마지막 구역 반영: ${fmt(lastUpdate)} (${lastUpdate ? Math.floor((now.getTime() - lastUpdate.getTime()) / DAY_MS) : "-"}일 전)`,
        "새 구역·단계 변경을 반영하려면 갱신할 구(최대 3개)를 지정해 Claude에게 \"재개발닷컴 구역도 업데이트해줘\"라고 요청해 주세요.",
        "(한 번에 몇 개 구만, 간격을 두고 가져옵니다. 보안 확인이 뜨면 자동으로 멈춥니다.)",
      ].join("\n");
      if (!(await this.telegram.send(text, chat))) return; // 전송 실패 — 다음 날 같은 시각에 다시 시도
      await this.reminders.save({ id: ROW_ID, lastSentAt: now });
      this.logger.log("재개발닷컴 구역도 업데이트 알림 발송");
    } finally {
      this.busy = false;
    }
  }
}
