import { Body, Controller, Delete, Get, Headers, Param, Patch, Post } from "@nestjs/common";
import {
  TagsService,
  type TagRuleInput,
  type StrategyRuleInput,
  type StrategyLabelMasterInput,
} from "./tags.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";

/** StrategyRule.labelIds는 DB에 JSON 배열 문자열로 저장돼 있어(requiredFactCodes와
 * 같은 패턴), 응답으로 내려주기 전에 실제 배열로 파싱한다. null/빈 값/파싱 실패는
 * 빈 배열로 취급한다(nullable 컬럼이라 마이그레이션 직후 값이 없을 수 있음). */
function parseLabelIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

@Controller("tag-rules")
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  // ---------- Fact 규칙 ----------

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

  @Get("fields/:key/value-options")
  async fieldValueOptions(
    @Headers() headers: Record<string, string>,
    @Param("key") key: string,
  ) {
    requireAuth(getAuthContext(headers));
    return this.tagsService.getFieldValueOptions(key);
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

  // ---------- Strategy 규칙(Fact 코드 조합 → Strategy 코드) ----------

  @Get("strategy-rules")
  async findAllStrategyRules(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    const rules = await this.tagsService.findAllStrategyRules();
    return rules.map((r) => ({
      ...r,
      requiredFactCodes: JSON.parse(r.requiredFactCodes || "[]"),
      labelIds: parseLabelIds(r.labelIds),
    }));
  }

  @Post("strategy-rules")
  async createStrategyRule(
    @Headers() headers: Record<string, string>,
    @Body() body: StrategyRuleInput,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.createStrategyRule(body);
  }

  @Patch("strategy-rules/:id")
  async updateStrategyRule(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: Partial<StrategyRuleInput>,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.updateStrategyRule(id, body);
  }

  @Delete("strategy-rules/:id")
  async removeStrategyRule(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.removeStrategyRule(id);
  }

  // ---------- Strategy 표시 문구(사용자 노출 라벨/설명) ----------

  @Get("strategy-labels")
  async findAllStrategyLabels(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.tagsService.findAllStrategyLabels();
  }

  @Post("strategy-labels")
  async createStrategyLabel(
    @Headers() headers: Record<string, string>,
    @Body() body: StrategyLabelMasterInput,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.createStrategyLabel(body);
  }

  @Patch("strategy-labels/:id")
  async updateStrategyLabel(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: Partial<StrategyLabelMasterInput>,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.updateStrategyLabelMaster(id, body);
  }

  @Delete("strategy-labels/:id")
  async removeStrategyLabel(@Headers() headers: Record<string, string>, @Param("id") id: string) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.removeStrategyLabel(id);
  }

  // ---------- 백필 ----------

  @Post("backfill")
  async backfill(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.tagsService.backfillTags();
  }
}
