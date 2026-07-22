import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RequestLogWriterService } from "./request-log-writer.service";
import { RequestLogMiddleware } from "./request-log.middleware";
import { SecurityLogAnalyzerService } from "./security-log-analyzer.service";
import { SecurityLogController } from "./security-log.controller";
import { SecurityLogIpExclusion } from "./security-log-ip-exclusion.entity";
import { RequestLog } from "./request-log.entity";
import { AiModule } from "../ai/ai.module";
import { KakaoNotifyModule } from "../kakao-notify/kakao-notify.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([SecurityLogIpExclusion, RequestLog]),
    AiModule,
    KakaoNotifyModule,
  ],
  providers: [RequestLogWriterService, RequestLogMiddleware, SecurityLogAnalyzerService],
  controllers: [SecurityLogController],
  exports: [RequestLogWriterService, RequestLogMiddleware],
})
export class SecurityLogModule {}
