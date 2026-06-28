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
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { UserRole } from "../common/constants";

@Controller("users")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
}
