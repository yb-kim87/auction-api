import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { LectureReplayService } from "./lecture-replay.service";
import type { LectureEnrollmentStatus } from "./entities/lecture-enrollment.entity";

/** 관리자 전용 강의 다시보기 관리 API(강의/섹션/영상/접근 링크 CRUD). */
@Controller("lecture-replay")
export class LectureReplayController {
  constructor(private readonly service: LectureReplayService) {}

  @Get("courses")
  listCourses(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listCourses();
  }

  @Post("courses")
  createCourse(
    @Headers() headers: Record<string, string>,
    @Body() body: { title?: string; description?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.createCourse(body);
  }

  @Patch("courses/:id")
  updateCourse(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body()
    body: { title?: string; description?: string; isPublished?: boolean; isOtCourse?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateCourse(id, body);
  }

  @Delete("courses/:id")
  deleteCourse(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteCourse(id);
  }

  @Get("sections")
  listSections(
    @Headers() headers: Record<string, string>,
    @Query("courseId") courseId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.listSections(courseId);
  }

  @Post("sections")
  createSection(
    @Headers() headers: Record<string, string>,
    @Body() body: { courseId?: string; title?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.createSection(body.courseId ?? "", body);
  }

  @Patch("sections/:id")
  updateSection(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { title?: string; sortOrder?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateSection(id, body);
  }

  @Delete("sections/:id")
  deleteSection(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteSection(id);
  }

  @Get("videos")
  listVideos(
    @Headers() headers: Record<string, string>,
    @Query("sectionId") sectionId: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.listVideos(sectionId);
  }

  @Post("videos")
  createVideo(
    @Headers() headers: Record<string, string>,
    @Body()
    body: {
      sectionId?: string;
      title?: string;
      description?: string;
      bunnyVideoId?: string;
      durationSeconds?: number;
      chapters?: Array<{ title?: string; startSeconds?: number; endSeconds?: number }>;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.createVideo(body.sectionId ?? "", body);
  }

  @Patch("videos/:id")
  updateVideo(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      description?: string;
      bunnyVideoId?: string;
      durationSeconds?: number | null;
      sortOrder?: number;
      isPublished?: boolean;
      isOtVideo?: boolean;
      chapters?: Array<{ title?: string; startSeconds?: number; endSeconds?: number }> | null;
    },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateVideo(id, body);
  }

  @Delete("videos/:id")
  deleteVideo(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteVideo(id);
  }

  @Get("links")
  listLinks(
    @Headers() headers: Record<string, string>,
    @Query("courseId") courseId?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.listLinks(courseId);
  }

  @Post("links")
  createLink(
    @Headers() headers: Record<string, string>,
    @Body() body: { courseId?: string; title?: string; expiresAt?: string | null },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.createLink(body);
  }

  @Patch("links/:id")
  updateLink(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { isActive?: boolean; expiresAt?: string | null },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateLink(id, body);
  }

  @Delete("links/:id")
  deleteLink(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteLink(id);
  }

  // ---------- 수강권(enrollment) ----------

  @Get("enrollments")
  listEnrollments(
    @Headers() headers: Record<string, string>,
    @Query("courseId") courseId?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.listEnrollments(courseId);
  }

  @Post("enrollments")
  grantEnrollment(
    @Headers() headers: Record<string, string>,
    @Body() body: { username?: string; courseId?: string; startsAt?: string; expiresAt?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.grantEnrollment(body);
  }

  @Post("enrollments/quick-90")
  grantEnrollmentQuick90(
    @Headers() headers: Record<string, string>,
    @Body() body: { username?: string; courseId?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.grantEnrollmentQuick90(body);
  }

  @Patch("enrollments/:id")
  updateEnrollment(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body()
    body: { startsAt?: string; expiresAt?: string; status?: LectureEnrollmentStatus },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.updateEnrollment(id, body);
  }

  @Post("enrollments/:id/revoke")
  revokeEnrollment(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.revokeEnrollment(id);
  }

  // ---------- 관리자: 강의자료(주차별 파일) ----------

  @Get("materials")
  listMaterials(@Headers() headers: Record<string, string>, @Query("sectionId") sectionId: string) {
    requireAdmin(getAuthContext(headers));
    if (!sectionId) throw new BadRequestException("sectionId 쿼리 파라미터가 필요합니다.");
    return this.service.listMaterials(sectionId);
  }

  @Post("materials")
  createMaterial(
    @Headers() headers: Record<string, string>,
    @Body() body: { sectionId?: string; title?: string; url?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.sectionId) throw new BadRequestException("sectionId가 필요합니다.");
    if (!body.url) throw new BadRequestException("링크(url)가 필요합니다.");
    return this.service.createMaterial(body.sectionId, {
      title: body.title ?? body.url,
      url: body.url,
    });
  }

  @Delete("materials/:id")
  deleteMaterial(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.service.deleteMaterial(id);
  }

  @Get("questions")
  listAllQuestions(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listAllQuestionsForAdmin();
  }

  @Patch("questions/:id/answer")
  answerQuestion(@Headers() headers: Record<string, string>, @Param("id") id: string, @Body() body: { answer?: string }) {
    requireAdmin(getAuthContext(headers));
    return this.service.answerQuestion(id, body.answer);
  }
}
