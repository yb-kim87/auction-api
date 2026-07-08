import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
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
