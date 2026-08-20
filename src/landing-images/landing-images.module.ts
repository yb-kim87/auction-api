import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LandingImageRow } from "./landing-image.entity";
import { LandingImagesController } from "./landing-images.controller";
import { LandingImagesService } from "./landing-images.service";

@Module({
  imports: [TypeOrmModule.forFeature([LandingImageRow])],
  controllers: [LandingImagesController],
  providers: [LandingImagesService],
  exports: [LandingImagesService],
})
export class LandingImagesModule {}
