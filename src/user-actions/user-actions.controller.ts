import { Body, Controller, Headers, Post } from "@nestjs/common";
import { getAuthContext, requireAuth } from "../common/auth-context";
import { UserActionsService } from "./user-actions.service";
import type { LogActionDto } from "./log-action.dto";

@Controller("actions")
export class UserActionsController {
  constructor(private readonly userActionsService: UserActionsService) {}

  @Post()
  async log(
    @Headers() headers: Record<string, string>,
    @Body() body: LogActionDto,
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.userActionsService.log(ctx.username, body);
  }

  @Post("batch")
  async logBatch(
    @Headers() headers: Record<string, string>,
    @Body() body: { items?: LogActionDto[] },
  ) {
    const ctx = getAuthContext(headers);
    requireAuth(ctx);
    return this.userActionsService.logBatch(ctx.username, body.items ?? []);
  }
}
