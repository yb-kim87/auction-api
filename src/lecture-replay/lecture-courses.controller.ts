import { Controller, Get, Headers, Param } from "@nestjs/common";
import { getAuthContext, requireAuth } from "../common/auth-context";
import { LectureReplayService } from "./lecture-replay.service";

/** 로그인한 회원이 자신의 수강권으로 강의를 보는 API. 스펙(2026-08-02):
 * 로그인 여부 + 수강권 존재/ACTIVE/기간 을 서버에서 검증하고, 실패 시
 * bunny_video_id/embed URL을 절대 내려주지 않는다. */
@Controller("courses")
export class LectureCoursesController {
  constructor(private readonly service: LectureReplayService) {}

  @Get()
  listMyCourses(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.service.listMyCourses(ctx.username);
  }

  @Get(":courseId")
  getCourseAccessInfo(
    @Headers() headers: Record<string, string>,
    @Param("courseId") courseId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.service.getMyCourseAccessInfo(ctx.username, courseId);
  }

  @Get(":courseId/videos/:videoId/play")
  getPlayUrl(
    @Headers() headers: Record<string, string>,
    @Param("courseId") courseId: string,
    @Param("videoId") videoId: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.service.getMyPlayUrl(ctx.username, courseId, videoId);
  }
}
