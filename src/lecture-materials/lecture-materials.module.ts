import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { LectureSlide } from "./lecture-slide.entity";
import { LectureMaterialsService } from "./lecture-materials.service";
import { LectureMaterialsController } from "./lecture-materials.controller";

@Module({
  imports: [TypeOrmModule.forFeature([LectureSlide])],
  providers: [LectureMaterialsService],
  controllers: [LectureMaterialsController],
  exports: [LectureMaterialsService],
})
export class LectureMaterialsModule {}
