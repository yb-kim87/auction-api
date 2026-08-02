import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Course } from "./entities/course.entity";
import { CourseSection } from "./entities/course-section.entity";
import { CourseVideo } from "./entities/course-video.entity";
import { LectureAccessLink } from "./entities/lecture-access-link.entity";
import { LectureReplayService } from "./lecture-replay.service";
import { LectureReplayController } from "./lecture-replay.controller";
import { LectureReplayPublicController } from "./lecture-replay-public.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([Course, CourseSection, CourseVideo, LectureAccessLink]),
  ],
  providers: [LectureReplayService],
  controllers: [LectureReplayController, LectureReplayPublicController],
  exports: [LectureReplayService],
})
export class LectureReplayModule {}
