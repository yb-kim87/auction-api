import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppSettingsRow } from "./site-settings.entity";
import { SiteSettingsController } from "./site-settings.controller";
import { SiteSettingsService } from "./site-settings.service";

@Module({
  imports: [TypeOrmModule.forFeature([AppSettingsRow])],
  controllers: [SiteSettingsController],
  providers: [SiteSettingsService],
  exports: [SiteSettingsService],
})
export class SiteSettingsModule {}
