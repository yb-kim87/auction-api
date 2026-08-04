import { Controller, Get, Param, Query } from "@nestjs/common";
import { LectureReplayService } from "./lecture-replay.service";

/** 링크 토큰만으로 접근하는 공개 시청 API. 로그인 계정이 아직 없으므로
 * 인증 없이 열어두되, 반드시 토큰 존재/활성/만료 여부를 서버에서
 * 검증한다(추후 회원별 수강권 기능이 붙기 전까지의 임시 접근 방식). */
@Controller("public/lecture-replay")
export class LectureReplayPublicController {
  constructor(private readonly service: LectureReplayService) {}

  @Get("access/:token")
  getAccessInfo(@Param("token") token: string) {
    return this.service.getAccessInfo(token);
  }

  @Get("access/:token/videos/:videoId/play")
  getPlayUrl(@Param("token") token: string, @Param("videoId") videoId: string, @Query("t") t?: string) {
    const startSeconds = t ? Number(t) : undefined;
    return this.service.getPlayUrl(token, videoId, Number.isFinite(startSeconds) ? startSeconds : undefined);
  }
}
