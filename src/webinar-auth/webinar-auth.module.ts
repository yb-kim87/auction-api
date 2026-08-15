import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { WebinarKakaoLead } from "./webinar-kakao-lead.entity";
import { WebinarEmailLead } from "./webinar-email-lead.entity";
import { WebinarAuthController } from "./webinar-auth.controller";
import { WebinarAuthService } from "./webinar-auth.service";
import { WebinarEmailAuthService } from "./webinar-email-auth.service";

@Module({
  imports: [TypeOrmModule.forFeature([WebinarKakaoLead, WebinarEmailLead])],
  controllers: [WebinarAuthController],
  providers: [WebinarAuthService, WebinarEmailAuthService],
})
export class WebinarAuthModule {}
