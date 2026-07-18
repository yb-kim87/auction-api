import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { TagRule } from "./tag-rule.entity";
import { StrategyRule } from "./strategy-rule.entity";
import { StrategyLabel } from "./strategy-label.entity";
import { Auction } from "../auctions/auction.entity";
import { RuleEngineService } from "./rule-engine.service";
import { RULE_FIELD_MAP, RULE_OPERATORS } from "./rule-field-registry";

export interface TagRuleInput {
  tagName: string;
  tagCode?: string;
  field: string;
  operator: string;
  value: string;
  active?: boolean;
  sortOrder?: number;
}

export interface StrategyRuleInput {
  strategyCode: string;
  requiredFactCodes: string[];
  active?: boolean;
  sortOrder?: number;
}

export interface StrategyLabelInput {
  strategyCode: string;
  label: string;
  description?: string;
  icon?: string;
}

/** "85㎡ 초과" → "AREA_OVER_85" 처럼 한글 라벨에서 안정적인 코드를 만든다(중복 시 -2, -3...) */
function slugifyToCode(text: string): string {
  const base = text
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
  return base || "TAG";
}

/** 최초 배포 시 예시로 미리 넣어두는 Fact 규칙(관리자가 이후 자유롭게 수정/삭제 가능) */
const DEFAULT_TAG_RULES: TagRuleInput[] = [
  {
    tagName: "85㎡ 초과",
    tagCode: "AREA_OVER_85",
    field: "area_sqm",
    operator: "gt",
    value: "85",
    sortOrder: 0,
  },
  {
    tagName: "아파트",
    tagCode: "USAGE_APARTMENT",
    field: "usage",
    operator: "eq",
    value: "아파트",
    sortOrder: 1,
  },
  {
    tagName: "재개발",
    tagCode: "REDEVELOPMENT",
    field: "special_note",
    operator: "contains",
    value: "재개발",
    sortOrder: 2,
  },
  { tagName: "구축", tagCode: "OLD_BUILDING", field: "built_year", operator: "lt", value: "2006", sortOrder: 3 },
  { tagName: "공장", tagCode: "USAGE_FACTORY", field: "usage", operator: "eq", value: "공장", sortOrder: 4 },
  {
    tagName: "저가 낙찰 가능",
    tagCode: "LOW_BID_RATIO",
    field: "min_price_ratio",
    operator: "lte",
    value: "70",
    sortOrder: 5,
  },
];

/**
 * 85㎡ 초과 아파트는 매도 시 부가세 부담 때문에 계산에 익숙하지 않은 입찰자들이 꺼려
 * 입찰경쟁이 낮아지는 경향이 있고, 그만큼 안전마진(저가 낙찰)을 확보할 가능성이 높아
 * 단기·중장기 투자 모두에 유리하다 — 이 판단을 Strategy 규칙으로 미리 심어둔다.
 */
const DEFAULT_STRATEGY_RULES: StrategyRuleInput[] = [
  {
    strategyCode: "COMPETITION_LOW_POSSIBLE",
    requiredFactCodes: ["AREA_OVER_85", "USAGE_APARTMENT"],
    sortOrder: 0,
  },
];

const DEFAULT_STRATEGY_LABELS: StrategyLabelInput[] = [
  {
    strategyCode: "COMPETITION_LOW_POSSIBLE",
    label: "경쟁이 적은 투자",
    description:
      "세금 계산을 어려워하는 입찰자가 적지 않아 경쟁이 낮아질 수 있는 물건입니다. " +
      "그만큼 안전마진을 확보한 채 낙찰받을 가능성이 있어 단기·중장기 투자 모두에 유리합니다.",
    icon: "gem",
  },
];

@Injectable()
export class TagsService implements OnModuleInit {
  constructor(
    @InjectRepository(TagRule)
    private readonly tagRuleRepo: Repository<TagRule>,
    @InjectRepository(StrategyRule)
    private readonly strategyRuleRepo: Repository<StrategyRule>,
    @InjectRepository(StrategyLabel)
    private readonly strategyLabelRepo: Repository<StrategyLabel>,
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly ruleEngine: RuleEngineService,
  ) {}

  async onModuleInit() {
    if ((await this.tagRuleRepo.count()) === 0) {
      for (const rule of DEFAULT_TAG_RULES) {
        await this.tagRuleRepo.save(
          this.tagRuleRepo.create({ ...rule, tagCode: rule.tagCode!, category: "fact" }),
        );
      }
    }
    if ((await this.strategyRuleRepo.count()) === 0) {
      for (const rule of DEFAULT_STRATEGY_RULES) {
        await this.strategyRuleRepo.save(
          this.strategyRuleRepo.create({
            strategyCode: rule.strategyCode,
            requiredFactCodes: JSON.stringify(rule.requiredFactCodes),
            active: rule.active ?? true,
            sortOrder: rule.sortOrder ?? 0,
          }),
        );
      }
    }
    if ((await this.strategyLabelRepo.count()) === 0) {
      for (const label of DEFAULT_STRATEGY_LABELS) {
        await this.strategyLabelRepo.save(this.strategyLabelRepo.create(label));
      }
    }
  }

  // ---------- Fact 규칙 (tag_rules) ----------

  findAllRules(): Promise<TagRule[]> {
    return this.tagRuleRepo.find({ order: { sortOrder: "ASC", createdAt: "ASC" } });
  }

  private validateFactInput(input: TagRuleInput) {
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

  private async uniqueCode(desired: string, excludeId?: string): Promise<string> {
    let code = desired;
    let n = 2;
    while (
      await this.tagRuleRepo.findOne({
        where: { tagCode: code },
      }).then((r) => r && r.id !== excludeId)
    ) {
      code = `${desired}_${n}`;
      n += 1;
    }
    return code;
  }

  async createRule(input: TagRuleInput): Promise<TagRule> {
    this.validateFactInput(input);
    const desiredCode = input.tagCode?.trim() ? slugifyToCode(input.tagCode) : slugifyToCode(input.tagName);
    const tagCode = await this.uniqueCode(desiredCode);
    const rule = this.tagRuleRepo.create({
      tagName: input.tagName.trim(),
      tagCode,
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
    this.validateFactInput(merged);

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

  // ---------- Strategy 규칙 (strategy_rules) ----------

  findAllStrategyRules(): Promise<StrategyRule[]> {
    return this.strategyRuleRepo.find({ order: { sortOrder: "ASC", createdAt: "ASC" } });
  }

  async createStrategyRule(input: StrategyRuleInput): Promise<StrategyRule> {
    if (!input.strategyCode?.trim()) {
      throw new BadRequestException("Strategy 코드를 입력해 주세요.");
    }
    if (!input.requiredFactCodes || input.requiredFactCodes.length === 0) {
      throw new BadRequestException("조건이 될 Fact 태그를 하나 이상 선택해 주세요.");
    }
    const rule = this.strategyRuleRepo.create({
      strategyCode: slugifyToCode(input.strategyCode),
      requiredFactCodes: JSON.stringify(input.requiredFactCodes),
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
    return this.strategyRuleRepo.save(rule);
  }

  async updateStrategyRule(id: string, input: Partial<StrategyRuleInput>): Promise<StrategyRule> {
    const rule = await this.strategyRuleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException("Strategy 규칙을 찾을 수 없습니다.");

    const prevCode = rule.strategyCode;
    if (input.strategyCode?.trim()) rule.strategyCode = slugifyToCode(input.strategyCode);
    if (input.requiredFactCodes) rule.requiredFactCodes = JSON.stringify(input.requiredFactCodes);
    if (input.active != null) rule.active = input.active;
    if (input.sortOrder != null) rule.sortOrder = input.sortOrder;
    const saved = await this.strategyRuleRepo.save(rule);

    // 전략 코드가 바뀌면, 이 코드로 사용자 노출 문구를 연결해둔 StrategyLabel도
    // 같이 옮겨줘야 라벨 연결이 끊기지 않는다(안 그러면 화면에 문구가 사라짐).
    if (prevCode !== saved.strategyCode) {
      await this.strategyLabelRepo.update(
        { strategyCode: prevCode },
        { strategyCode: saved.strategyCode },
      );
    }

    return saved;
  }

  async removeStrategyRule(id: string): Promise<{ ok: boolean }> {
    const result = await this.strategyRuleRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("Strategy 규칙을 찾을 수 없습니다.");
    return { ok: true };
  }

  // ---------- Strategy 표시 문구 (strategy_labels) ----------

  findAllStrategyLabels(): Promise<StrategyLabel[]> {
    return this.strategyLabelRepo.find({ order: { createdAt: "ASC" } });
  }

  async upsertStrategyLabel(input: StrategyLabelInput): Promise<StrategyLabel> {
    if (!input.strategyCode?.trim() || !input.label?.trim()) {
      throw new BadRequestException("Strategy 코드와 노출 문구를 입력해 주세요.");
    }
    const code = slugifyToCode(input.strategyCode);
    const existing = await this.strategyLabelRepo.findOne({ where: { strategyCode: code } });
    if (existing) {
      existing.label = input.label.trim();
      existing.description = input.description?.trim() ?? "";
      existing.icon = input.icon?.trim() ?? "";
      return this.strategyLabelRepo.save(existing);
    }
    return this.strategyLabelRepo.save(
      this.strategyLabelRepo.create({
        strategyCode: code,
        label: input.label.trim(),
        description: input.description?.trim() ?? "",
        icon: input.icon?.trim() ?? "",
      }),
    );
  }

  async removeStrategyLabel(id: string): Promise<{ ok: boolean }> {
    const result = await this.strategyLabelRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("Strategy 문구를 찾을 수 없습니다.");
    return { ok: true };
  }

  // ---------- 계산/백필 ----------

  /**
   * 물건 하나의 factTags(Fact 코드 배열)와 strategyTags(사용자 노출용 {code,label,
   * description,icon} 배열)를 현재 활성 규칙 기준으로 재계산한다(저장은 호출자 책임).
   */
  async computeTagsFor(
    item: Auction,
  ): Promise<{ factCodes: string[]; strategyItems: Array<{ code: string; label: string; description: string; icon: string }> }> {
    const [factRules, strategyRules, labels] = await Promise.all([
      this.findAllRules(),
      this.findAllStrategyRules(),
      this.findAllStrategyLabels(),
    ]);
    const factCodes = this.ruleEngine.computeFactCodes(item, factRules);
    const strategyCodes = this.ruleEngine.computeStrategyCodes(factCodes, strategyRules);
    const labelMap = new Map(labels.map((l) => [l.strategyCode, l]));
    const strategyItems = strategyCodes
      .map((code) => {
        const label = labelMap.get(code);
        if (!label) return null;
        return { code, label: label.label, description: label.description, icon: label.icon };
      })
      .filter((v): v is { code: string; label: string; description: string; icon: string } => v != null);
    return { factCodes, strategyItems };
  }

  /** 기존에 등록된 모든 물건의 factTags/strategyTags를 현재 활성 규칙 기준으로 일괄 재계산한다 */
  async backfillTags(): Promise<{ total: number; updated: number }> {
    const [factRules, strategyRules, labels] = await Promise.all([
      this.findAllRules(),
      this.findAllStrategyRules(),
      this.findAllStrategyLabels(),
    ]);
    const labelMap = new Map(labels.map((l) => [l.strategyCode, l]));
    const items = await this.auctionRepo.find();

    let updated = 0;
    for (const item of items) {
      const factCodes = this.ruleEngine.computeFactCodes(item, factRules);
      const strategyCodes = this.ruleEngine.computeStrategyCodes(factCodes, strategyRules);
      const strategyItems = strategyCodes
        .map((code) => {
          const label = labelMap.get(code);
          if (!label) return null;
          return { code, label: label.label, description: label.description, icon: label.icon };
        })
        .filter((v): v is { code: string; label: string; description: string; icon: string } => v != null);

      const nextFactJson = JSON.stringify(factCodes);
      const nextStrategyJson = JSON.stringify(strategyItems);
      if (item.factTags !== nextFactJson || item.strategyTags !== nextStrategyJson) {
        item.factTags = nextFactJson;
        item.strategyTags = nextStrategyJson;
        await this.auctionRepo.save(item);
        updated += 1;
      }
    }
    return { total: items.length, updated };
  }

  getFieldRegistry() {
    return {
      fields: [...RULE_FIELD_MAP.values()].map((f) => ({ key: f.key, label: f.label, type: f.type })),
      operators: RULE_OPERATORS,
    };
  }
}
