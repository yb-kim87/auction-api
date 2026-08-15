import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuctionAssignment, ServiceReport } from "./learning-board.entity";
import { LearningBoardController } from "./learning-board.controller";
import { LearningBoardService } from "./learning-board.service";
import { KakaoNotifyModule } from "../kakao-notify/kakao-notify.module";
import { UsersModule } from "../users/users.module";
import { SiteSettingsModule } from "../site-settings/site-settings.module";
@Module({
  imports: [TypeOrmModule.forFeature([AuctionAssignment, ServiceReport]), KakaoNotifyModule, UsersModule, SiteSettingsModule],
  controllers: [LearningBoardController],
  providers: [LearningBoardService],
})
export class LearningBoardModule {}
