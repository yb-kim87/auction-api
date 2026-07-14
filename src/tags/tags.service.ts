import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TagRule } from "./tag-rule.entity";
import { Auction } from "../auctions/auction.entity";
import { RuleEngineService } from "./rule-engine.service";
import { RULE_FIELD_MAP, RULE_OPERATORS } from "./rule-field-registry";

export interface TagRuleInput {
  tagName: string;
  field: string;
  operator: string;
  value: string;
  active?: boolean;
  sortOrder?: number;
}

/** 최초 배포 시 예시로 미리 넣어두는 규칙(관리자가 이후 자유롭게 수정/삭제 가능) */
const DEFAULT_TAG_RULES: TagRuleInput[] = [
  { tagName: "85㎡ 초과", field: "area_sqm", operator: "gt", value: "85", sortOrder: 0 },
  { tagName: "부가세 검토 필요", field: "area_sqm", operator: "gt", value: "85", sortOrder: 1 },
  { tagName: "재개발", field: "special_note", operator: "contains", value: "재개발", sortOrder: 2 },
  { tagName: "구축", field: "built_year", operator: "lt", value: "2006", sortOrder: 3 },
  { tagName: "공장", field: "usage", operator: "eq", value: "공장", sortOrder: 4 },
  {
    tagName: "저가 낙찰 가능",
    field: "min_price_ratio",
    operator: "lte",
    value: "70",
    sortOrder: 5,
  },
];

@Injectable()
export class TagsService implements OnModuleInit {
  constructor(
    @InjectRepository(TagRule)
    private readonly tagRuleRepo: Repository<TagRule>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  async onModuleInit() {
    const count = await this.tagRuleRepo.count();
    if (count > 0) return;
    for (const rule of DEFAULT_TAG_RULES) {
      await this.tagRuleRepo.save(this.tagRuleRepo.create({ ...rule, category: "fact" }));
    }
  }

  findAllRules(): Promise<TagRule[]> {
    return this.tagRuleRepo.find({ order: { sortOrder: "ASC", createdAt: "ASC" } });
  }

  private validateInput(input: TagRuleInput) {
    if (!input.tagName?.trim()) {
      throw new BadRequestException("태그명을 입력해 주세요.");
    }
    if (!RULE_FIELD_MAP.has(input.field)) {
      throw new BadRequestException("지원하지 않는 필드입니다.");
    }
    if (!RULE_OPERATORS.some((op) => op.key === input.operator)) {
      throw new BadRequestException("지원하지 않는 연산자입니다.");
    }
    if (!input.value?.trim() && input.value !== "0") {
      throw new BadRequestException("조건 값을 입력해 주세요.");
    }
  }

  async createRule(input: TagRuleInput): Promise<TagRule> {
    this.validateInput(input);
    const rule = this.tagRuleRepo.create({
      tagName: input.tagName.trim(),
      category: "fact",
      field: input.field,
      operator: input.operator,
      value: input.value,
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
    return this.tagRuleRepo.save(rule);
  }

  async updateRule(id: string, input: Partial<TagRuleInput>): Promise<TagRule> {
    const rule = await this.tagRuleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException("태그 규칙을 찾을 수 없습니다.");

    const merged: TagRuleInput = {
      tagName: input.tagName ?? rule.tagName,
      field: input.field ?? rule.field,
      operator: input.operator ?? rule.operator,
      value: input.value ?? rule.value,
      active: input.active ?? rule.active,
      sortOrder: input.sortOrder ?? rule.sortOrder,
    };
    this.validateInput(merged);

    rule.tagName = merged.tagName.trim();
    rule.field = merged.field;
    rule.operator = merged.operator;
    rule.value = merged.value;
    rule.active = merged.active ?? true;
    rule.sortOrder = merged.sortOrder ?? 0;
    return this.tagRuleRepo.save(rule);
  }

  async removeRule(id: string): Promise<{ ok: boolean }> {
    const result = await this.tagRuleRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("태그 규칙을 찾을 수 없습니다.");
    return { ok: true };
  }

  /** 물건 하나의 factTags를 현재 활성 규칙 기준으로 재계산해 반환한다(저장은 호출자 책임) */
  async computeFactTagsFor(item: Auction): Promise<string[]> {
    const rules = await this.findAllRules();
    return this.ruleEngine.computeFactTags(item, rules);
  }

  /** 기존에 등록된 모든 물건의 factTags를 현재 활성 규칙 기준으로 일괄 재계산한다 */
  async backfillFactTags(): Promise<{ total: number; updated: number }> {
    const rules = await this.findAllRules();
    const items = await this.auctionRepo.find();

    let updated = 0;
    for (const item of items) {
      const nextTags = this.ruleEngine.computeFactTags(item, rules);
      const nextJson = JSON.stringify(nextTags);
      if (item.factTags !== nextJson) {
        item.factTags = nextJson;
        await this.auctionRepo.save(item);
        updated += 1;
      }
    }
    return { total: items.length, updated };
  }

  getFieldRegistry() {
    return { fields: [...RULE_FIELD_MAP.values()].map((f) => ({ key: f.key, label: f.label, type: f.type })), operators: RULE_OPERATORS };
  }
}
