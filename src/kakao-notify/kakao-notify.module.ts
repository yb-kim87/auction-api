import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KakaoLead } from "./kakao-lead.entity";
import { KakaoDispatchLog } from "./kakao-dispatch-log.entity";
import { KakaoSyncState } from "./kakao-sync-state.entity";
import { KakaoNotifySetting } from "./kakao-notify-setting.entity";
import { SolapiService } from "./solapi.service";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";
import { KakaoNotifySettingService } from "./kakao-notify-setting.service";
import { GoogleSheetsService } from "./google-sheets.service";
import { ImwebSyncService } from "./imweb-sync.service";
import { InstagramSyncService } from "./instagram-sync.service";
import { KakaoNotifyScheduler } from "./kakao-notify.scheduler";
import { KakaoSyncRunnerService } from "./kakao-sync-runner.service";
import { TelegramAlertService } from "./telegram-alert.service";
import { KakaoNotifyController } from "./kakao-notify.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KakaoLead,
      KakaoDispatchLog,
      KakaoSyncState,
      KakaoNotifySetting,
    ]),
  ],
  providers: [
    SolapiService,
    KakaoNotifyService,
    KakaoSyncStateService,
    KakaoNotifySettingService,
    GoogleSheetsService,
    ImwebSyncService,
    InstagramSyncService,
    KakaoNotifyScheduler,
    KakaoSyncRunnerService,
    TelegramAlertService,
  ],
  controllers: [KakaoNotifyController],
  exports: [KakaoNotifyService, SolapiService],
})
export class KakaoNotifyModule {}
