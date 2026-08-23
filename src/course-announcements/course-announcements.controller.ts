import { Body, Controller, Delete, Get, Headers, Param, Post, Put } from "@nestjs/common";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";
import { CourseAnnouncementsService } from "./course-announcements.service";

@Controller("course-announcements")
export class CourseAnnouncementsController {
  constructor(private readonly service: CourseAnnouncementsService) {}

  /** 로그인한 수강생이면 누구나 조회 가능(강의실 대시보드 공지사항 영역). */
  @Get()
  async list(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.service.list();
  }

  @Post()
  async create(
    @Headers() headers: Record<string, string>,
    @Body() body: { title?: string; body?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.create(body.title ?? "", body.body ?? "");
  }

  @Put(":id")
  async update(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { title?: string; body?: string },
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.update(id, body.title ?? "", body.body ?? "");
  }

  @Delete(":id")
  async remove(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    await this.service.remove(id);
    return { removed: true };
  }
}
