import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AiPlatformHistory } from "./ai-platform-history.entity";
import { AiPlatformHistoryService } from "./ai-platform-history.service";

@Module({
  imports: [TypeOrmModule.forFeature([AiPlatformHistory])],
  providers: [AiPlatformHistoryService],
  exports: [AiPlatformHistoryService],
})
export class AiPlatformSharedModule {}
