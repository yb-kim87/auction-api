import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import { TagsService, type TagRuleInput } from "./tags.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";

@Controller("tag-rules")
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  async findAll(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.tagsService.findAllRules();
  }

  @Get("fields")
  async fields(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.tagsService.getFieldRegistry();
  }

  @Post()
  async create(@Headers() headers: Record<string, string>, @Body() body: TagRuleInput) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.createRule(body);
  }

  @Patch(":id")
  async update(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: Partial<TagRuleInput>,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.updateRule(id, body);
  }

  @Delete(":id")
  async remove(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.removeRule(id);
  }

  @Post("backfill")
  async backfill(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.backfillFactTags();
  }
}
