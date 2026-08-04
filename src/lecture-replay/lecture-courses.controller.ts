import { Body, Controller, Delete, Get, Headers, Param, Post, Query } from "@nestjs/common";
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
    @Query("t") t?: string,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const startSeconds = t ? Number(t) : undefined;
    return this.service.getMyPlayUrl(
      ctx.username,
      courseId,
      videoId,
      Number.isFinite(startSeconds) ? startSeconds : undefined,
    );
  }

  @Post(":courseId/videos/:videoId/progress")
  saveProgress(
    @Headers() headers: Record<string, string>,
    @Param("courseId") courseId: string,
    @Param("videoId") videoId: string,
    @Body() body: { chapterStartSeconds?: number; lastPositionSeconds?: number; isCompleted?: boolean },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.service.saveMyProgress(ctx.username, courseId, videoId, body);
  }

  @Get(":courseId/questions")
  listQuestions(@Headers() headers: Record<string, string>, @Param("courseId") courseId: string, @Query("videoId") videoId?: string) {
    const ctx = getAuthContext(headers); requireAuth(ctx);
    return this.service.listMyQuestions(ctx.username, courseId, videoId);
  }

  @Post(":courseId/questions")
  createQuestion(@Headers() headers: Record<string, string>, @Param("courseId") courseId: string, @Body() body: { videoId?: string; chapterStartSeconds?: number; positionSeconds?: number; question?: string }) {
    const ctx = getAuthContext(headers); requireAuth(ctx);
    return this.service.createMyQuestion(ctx.username, courseId, body);
  }

  @Get(":courseId/notes")
  listNotes(@Headers() headers: Record<string, string>, @Param("courseId") courseId: string, @Query("videoId") videoId?: string) {
    const ctx = getAuthContext(headers); requireAuth(ctx);
    return this.service.listMyNotes(ctx.username, courseId, videoId);
  }

  @Post(":courseId/notes")
  createNote(@Headers() headers: Record<string, string>, @Param("courseId") courseId: string, @Body() body: { videoId?: string; chapterStartSeconds?: number; positionSeconds?: number; content?: string }) {
    const ctx = getAuthContext(headers); requireAuth(ctx);
    return this.service.createMyNote(ctx.username, courseId, body);
  }

  @Delete(":courseId/notes/:noteId")
  deleteNote(@Headers() headers: Record<string, string>, @Param("courseId") courseId: string, @Param("noteId") noteId: string) {
    const ctx = getAuthContext(headers); requireAuth(ctx);
    return this.service.deleteMyNote(ctx.username, courseId, noteId);
  }
}
