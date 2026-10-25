import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  ForbiddenException,
} from "@nestjs/common";
import { UsersService } from "./users.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";
import { UserRole } from "../common/constants";
import type { UpdateProfileDto } from "./update-profile.dto";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  async getMe(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.usersService.getProfileByUsername(ctx.username);
  }

  @Patch("me")
  async updateMe(
    @Headers() headers: Record<string, string>,
    @Body() body: UpdateProfileDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    const user = await this.usersService.updateProfile(ctx.username, body);
    return user;
  }

  @Get()
  async findAll(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    const users = await this.usersService.findAll();
    return users.map((user) => this.usersService.sanitize(user));
  }

  /** 강의 수강권 부여 화면에서 이름/아이디/전화번호로 회원을 찾는다. */
  @Get("search")
  async search(
    @Headers() headers: Record<string, string>,
    @Query("q") q: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.usersService.searchUsers(q ?? "");
  }

  @Patch(":id/role")
  async updateRole(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { role?: UserRole },
  ) {
    requireAdmin(getAuthContext(headers));
    if (!body.role || !Object.values(UserRole).includes(body.role)) {
      throw new ForbiddenException("유효하지 않은 권한입니다.");
    }
    const user = await this.usersService.updateRole(id, body.role);
    return this.usersService.sanitize(user);
  }

  /** 수강생 이용 기한 설정. expiresAt은 "YYYY-MM-DD"(그날 한국시간 23:59:59까지 이용)이거나 null(기한 없음). */
  @Patch(":id/role-expiry")
  async updateRoleExpiry(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { expiresAt?: string | null },
  ) {
    requireAdmin(getAuthContext(headers));
    let expiresAt: Date | null = null;
    if (body.expiresAt) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt)) {
        throw new ForbiddenException("만료일 형식이 올바르지 않습니다(YYYY-MM-DD).");
      }
      expiresAt = new Date(`${body.expiresAt}T23:59:59+09:00`);
      if (Number.isNaN(expiresAt.getTime())) throw new ForbiddenException("만료일이 올바르지 않습니다.");
    }
    const user = await this.usersService.setRoleExpiry(id, expiresAt);
    return this.usersService.sanitize(user);
  }

  @Delete(":id")
  async deleteUser(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.usersService.deleteUser(id);
  }

  @Patch(":id/ai-limit")
  async updateAiAnalysisLimit(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { limit?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    const user = await this.usersService.updateAiAnalysisLimit(
      id,
      Number(body.limit),
    );
    return this.usersService.sanitize(user);
  }
}
