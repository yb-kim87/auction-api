import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KakaoLead } from "./kakao-lead.entity";
import { KakaoDispatchLog } from "./kakao-dispatch-log.entity";
import { KakaoSyncState } from "./kakao-sync-state.entity";
import { KakaoNotifySetting } from "./kakao-notify-setting.entity";
import { KakaoScheduledDispatch } from "./kakao-scheduled-dispatch.entity";
import { KakaoAdCreative } from "./kakao-ad-creative.entity";
import { KakaoLandingVisit } from "./kakao-landing-visit.entity";
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
import { KakaoScheduledDispatchService } from "./kakao-scheduled-dispatch.service";
import { KakaoAdCreativeService } from "./kakao-ad-creative.service";
import { KakaoLandingVisitService } from "./kakao-landing-visit.service";
import { KakaoNotifyController } from "./kakao-notify.controller";
import { KakaoLandingVisitController } from "./kakao-landing-visit.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KakaoLead,
      KakaoDispatchLog,
      KakaoSyncState,
      KakaoNotifySetting,
      KakaoScheduledDispatch,
      KakaoAdCreative,
      KakaoLandingVisit,
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
    KakaoScheduledDispatchService,
    KakaoAdCreativeService,
    KakaoLandingVisitService,
  ],
  controllers: [KakaoNotifyController, KakaoLandingVisitController],
  exports: [KakaoNotifyService, SolapiService],
})
export class KakaoNotifyModule {}
