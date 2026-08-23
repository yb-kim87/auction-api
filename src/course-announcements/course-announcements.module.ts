import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CourseAnnouncementRow } from "./course-announcement.entity";
import { CourseAnnouncementsController } from "./course-announcements.controller";
import { CourseAnnouncementsService } from "./course-announcements.service";

@Module({
  imports: [TypeOrmModule.forFeature([CourseAnnouncementRow])],
  controllers: [CourseAnnouncementsController],
  providers: [CourseAnnouncementsService],
})
export class CourseAnnouncementsModule {}
