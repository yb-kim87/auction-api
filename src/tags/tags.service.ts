import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { TagRule } from "./tag-rule.entity";
import { StrategyRule } from "./strategy-rule.entity";
import { StrategyLabel } from "./strategy-label.entity";
import { Auction } from "../auctions/auction.entity";
import { RuleEngineService } from "./rule-engine.service";
import {
  RULE_FIELD_MAP,
  RULE_OPERATORS,
  RULE_VALUE_OPTIONS_FIELDS,
  SPECIAL_NOTE_KEYWORD_OPTIONS,
} from "./rule-field-registry";

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
  /** 이 전략에 연결할 기존 라벨 마스터의 id 목록(관리자가 드롭박스에서 다중 선택).
   * 전략 하나가 여러 배지(라벨)를 동시에 가질 수 있다. */
  labelIds?: string[];
  /** 사용자 노출용 설명 문구(전략마다 다르게 작성) */
  description?: string;
  active?: boolean;
  sortOrder?: number;
}

export interface StrategyLabelInput {
  strategyCode: string;
  label: string;
  icon?: string;
}

/** 관리자가 재사용 가능한 라벨 문구를 미리 등록/수정하는 마스터 CRUD 입력 */
export interface StrategyLabelMasterInput {
  label: string;
  icon?: string;
}

function parseStrategyLabelIds(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
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
    description:
      "세금 계산을 어려워하는 입찰자가 적지 않아 경쟁이 낮아질 수 있는 물건입니다. " +
      "그만큼 안전마진을 확보한 채 낙찰받을 가능성이 있어 단기·중장기 투자 모두에 유리합니다.",
    sortOrder: 0,
  },
];

const DEFAULT_STRATEGY_LABELS: StrategyLabelInput[] = [
  {
    strategyCode: "COMPETITION_LOW_POSSIBLE",
    label: "경쟁이 적은 투자",
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
      const labelIdByStrategyCode = new Map<string, string>();
      if ((await this.strategyLabelRepo.count()) === 0) {
        for (const label of DEFAULT_STRATEGY_LABELS) {
          const saved = await this.strategyLabelRepo.save(
            this.strategyLabelRepo.create({ label: label.label, icon: label.icon }),
          );
          labelIdByStrategyCode.set(label.strategyCode, saved.id);
        }
      }
      for (const rule of DEFAULT_STRATEGY_RULES) {
        const labelId = labelIdByStrategyCode.get(rule.strategyCode);
        await this.strategyRuleRepo.save(
          this.strategyRuleRepo.create({
            strategyCode: rule.strategyCode,
            requiredFactCodes: JSON.stringify(rule.requiredFactCodes),
            labelIds: JSON.stringify(labelId ? [labelId] : []),
            description: rule.description ?? "",
            active: rule.active ?? true,
            sortOrder: rule.sortOrder ?? 0,
          }),
        );
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
    const saved = await this.tagRuleRepo.save(rule);
    await this.backfillTags();
    return saved;
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
    const saved = await this.tagRuleRepo.save(rule);
    await this.backfillTags();
    return saved;
  }

  async removeRule(id: string): Promise<{ ok: boolean }> {
    const result = await this.tagRuleRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("태그 규칙을 찾을 수 없습니다.");
    await this.backfillTags();
    return { ok: true };
  }

  // ---------- Strategy 규칙 (strategy_rules) ----------

  findAllStrategyRules(): Promise<StrategyRule[]> {
    return this.strategyRuleRepo.find({ order: { sortOrder: "ASC", createdAt: "ASC" } });
  }

  private async validateLabelIds(labelIds: string[]): Promise<void> {
    if (labelIds.length === 0) return;
    const uniqueIds = [...new Set(labelIds)];
    const found = await this.strategyLabelRepo.find({ where: { id: In(uniqueIds) } });
    if (found.length !== uniqueIds.length) {
      throw new BadRequestException("선택한 라벨 중 존재하지 않는 항목이 있습니다.");
    }
  }

  async createStrategyRule(input: StrategyRuleInput): Promise<StrategyRule> {
    if (!input.strategyCode?.trim()) {
      throw new BadRequestException("Strategy 코드를 입력해 주세요.");
    }
    if (!input.requiredFactCodes || input.requiredFactCodes.length === 0) {
      throw new BadRequestException("조건이 될 Fact 태그를 하나 이상 선택해 주세요.");
    }
    const labelIds = input.labelIds ?? [];
    await this.validateLabelIds(labelIds);
    const strategyCode = slugifyToCode(input.strategyCode);
    const rule = this.strategyRuleRepo.create({
      strategyCode,
      requiredFactCodes: JSON.stringify(input.requiredFactCodes),
      labelIds: JSON.stringify(labelIds),
      description: input.description?.trim() ?? "",
      active: input.active ?? true,
      sortOrder: input.sortOrder ?? 0,
    });
    const saved = await this.strategyRuleRepo.save(rule);
    await this.backfillTags();
    return saved;
  }

  async updateStrategyRule(id: string, input: Partial<StrategyRuleInput>): Promise<StrategyRule> {
    const rule = await this.strategyRuleRepo.findOne({ where: { id } });
    if (!rule) throw new NotFoundException("Strategy 규칙을 찾을 수 없습니다.");

    if (input.strategyCode?.trim()) rule.strategyCode = slugifyToCode(input.strategyCode);
    if (input.requiredFactCodes) rule.requiredFactCodes = JSON.stringify(input.requiredFactCodes);
    if (input.description !== undefined) rule.description = input.description.trim();
    if (input.labelIds !== undefined) {
      await this.validateLabelIds(input.labelIds);
      rule.labelIds = JSON.stringify(input.labelIds);
    }
    if (input.active != null) rule.active = input.active;
    if (input.sortOrder != null) rule.sortOrder = input.sortOrder;
    const saved = await this.strategyRuleRepo.save(rule);
    await this.backfillTags();
    return saved;
  }

  async removeStrategyRule(id: string): Promise<{ ok: boolean }> {
    const result = await this.strategyRuleRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("Strategy 규칙을 찾을 수 없습니다.");
    await this.backfillTags();
    return { ok: true };
  }

  // ---------- 라벨 마스터 (strategy_labels) ----------
  // 관리자가 재사용 가능한 노출 문구를 미리 등록해두고, 전략 규칙 생성 시
  // 이 목록에서 드롭박스로 골라 strategyCode에 연결한다.

  findAllStrategyLabels(): Promise<StrategyLabel[]> {
    return this.strategyLabelRepo.find({ order: { createdAt: "ASC" } });
  }

  async createStrategyLabel(input: StrategyLabelMasterInput): Promise<StrategyLabel> {
    if (!input.label?.trim()) {
      throw new BadRequestException("노출 문구(라벨)를 입력해 주세요.");
    }
    return this.strategyLabelRepo.save(
      this.strategyLabelRepo.create({
        strategyCode: "",
        label: input.label.trim(),
        icon: input.icon?.trim() ?? "",
      }),
    );
  }

  async updateStrategyLabelMaster(
    id: string,
    input: Partial<StrategyLabelMasterInput>,
  ): Promise<StrategyLabel> {
    const label = await this.strategyLabelRepo.findOne({ where: { id } });
    if (!label) throw new NotFoundException("라벨을 찾을 수 없습니다.");
    if (input.label !== undefined) {
      if (!input.label.trim()) throw new BadRequestException("노출 문구(라벨)를 입력해 주세요.");
      label.label = input.label.trim();
    }
    if (input.icon !== undefined) label.icon = input.icon.trim();
    return this.strategyLabelRepo.save(label);
  }

  async removeStrategyLabel(id: string): Promise<{ ok: boolean }> {
    const result = await this.strategyLabelRepo.delete({ id });
    if (!result.affected) throw new NotFoundException("라벨을 찾을 수 없습니다.");
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
    const labelMap = new Map(labels.map((l) => [l.id, l]));
    const ruleMap = new Map(strategyRules.map((r) => [r.strategyCode, r]));
    const strategyItems = this.buildStrategyItemsForCodes(strategyCodes, ruleMap, labelMap);
    return { factCodes, strategyItems };
  }

  /**
   * 매칭된 전략 코드들이 가진 라벨을 물건 상세에 노출할 {code,label,description,icon}
   * 배지 목록으로 만든다. 같은 라벨이 서로 다른 전략에 동시에 붙어있으면(예: "경쟁이
   * 적은 투자"가 "85_초과+아파트"와 "미상임차인" 둘 다에 쓰인 경우) 화면에 같은
   * 배지가 두 번 뜨는 대신 라벨 하나로 합치고, 설명은 줄바꿈으로 이어붙인다.
   */
  private buildStrategyItemsForCodes(
    strategyCodes: string[],
    ruleMap: Map<string, StrategyRule>,
    labelMap: Map<string, StrategyLabel>,
  ): Array<{ code: string; label: string; description: string; icon: string }> {
    const byLabelId = new Map<
      string,
      { code: string; label: StrategyLabel; descriptions: string[] }
    >();

    for (const code of strategyCodes) {
      const rule = ruleMap.get(code);
      if (!rule) continue;
      const labelIds = parseStrategyLabelIds(rule.labelIds);
      for (const labelId of labelIds) {
        const label = labelMap.get(labelId);
        if (!label) continue;
        const existing = byLabelId.get(labelId);
        if (existing) {
          if (rule.description && !existing.descriptions.includes(rule.description)) {
            existing.descriptions.push(rule.description);
          }
        } else {
          byLabelId.set(labelId, {
            code,
            label,
            descriptions: rule.description ? [rule.description] : [],
          });
        }
      }
    }

    return [...byLabelId.values()].map(({ code, label, descriptions }) => ({
      code,
      label: label.label,
      description: descriptions.join("\n\n"),
      icon: label.icon,
    }));
  }

  /** 기존에 등록된 모든 물건의 factTags/strategyTags를 현재 활성 규칙 기준으로 일괄 재계산한다 */
  async backfillTags(): Promise<{ total: number; updated: number }> {
    const [factRules, strategyRules, labels] = await Promise.all([
      this.findAllRules(),
      this.findAllStrategyRules(),
      this.findAllStrategyLabels(),
    ]);
    const labelMap = new Map(labels.map((l) => [l.id, l]));
    const ruleMap = new Map(strategyRules.map((r) => [r.strategyCode, r]));
    const items = await this.auctionRepo.find();

    let updated = 0;
    for (const item of items) {
      const factCodes = this.ruleEngine.computeFactCodes(item, factRules);
      const strategyCodes = this.ruleEngine.computeStrategyCodes(factCodes, strategyRules);
      const strategyItems = this.buildStrategyItemsForCodes(strategyCodes, ruleMap, labelMap);

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

  /** 각 Fact/Strategy 규칙이 현재 몇 건의 물건에 매칭되는지 집계한다. 매
   * 요청마다 규칙 엔진을 다시 돌리지 않고 auctions.factTags에 저장된
   * fact 코드 배열만 세므로, 물건 수가 늘어나도 카운트 자체는 빠르다
   * (규칙 변경 직후엔 create/update/remove가 자동으로 backfillTags를
   * 호출해 이 컬럼을 최신 상태로 맞춰둔다 — 사용자 요청, 2026-07-22).
   *
   * strategyTags 컬럼은 쓰지 않는다 — buildStrategyItemsForCodes가 같은
   * 라벨을 쓰는 여러 strategyCode를 하나로 병합하면서 code 하나만 남기기
   * 때문에(라벨 공유 시 다른 strategyCode가 저장에서 누락됨), strategy
   * 규칙의 requiredFactCodes를 factTags 집합에 직접 대조해서 센다.
   */
  async getRuleMatchCounts(): Promise<{
    factCounts: Record<string, number>;
    strategyCounts: Record<string, number>;
  }> {
    const [items, strategyRules] = await Promise.all([
      // @AfterLoad 훅(normalizeDisplayFields)이 select 여부와 무관하게
      // address 등 여러 필드에 접근하므로, 부분 select를 쓰면 해당 필드가
      // undefined가 되어 훅 내부에서 예외가 난다(실측: "Cannot read
      // properties of undefined (reading 'replace')", 2026-07-22).
      // 전체 컬럼을 로드해야 안전하다.
      this.auctionRepo.find(),
      this.findAllStrategyRules(),
    ]);

    const factCounts: Record<string, number> = {};
    const strategyCounts: Record<string, number> = {};
    for (const rule of strategyRules) {
      strategyCounts[rule.strategyCode] = 0;
    }

    for (const item of items) {
      let factCodes: string[] = [];
      try {
        const parsed = JSON.parse(item.factTags || "[]");
        if (Array.isArray(parsed)) factCodes = parsed;
      } catch {
        // 무시
      }
      const factSet = new Set(factCodes);
      for (const code of factCodes) {
        factCounts[code] = (factCounts[code] ?? 0) + 1;
      }
      for (const rule of strategyRules) {
        const required = parseStrategyLabelIds(rule.requiredFactCodes);
        if (required.length > 0 && required.every((c) => factSet.has(c))) {
          strategyCounts[rule.strategyCode] += 1;
        }
      }
    }

    return { factCounts, strategyCounts };
  }

  getFieldRegistry() {
    return {
      fields: [...RULE_FIELD_MAP.values()].map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        hasValueOptions: RULE_VALUE_OPTIONS_FIELDS.has(f.key),
      })),
      operators: RULE_OPERATORS,
    };
  }

  /** usage처럼 실제 DB에 어떤 값이 있는지 미리 알 수 없는 필드의 드롭박스용 후보 목록. */
  async getFieldValueOptions(fieldKey: string): Promise<string[]> {
    if (!RULE_VALUE_OPTIONS_FIELDS.has(fieldKey)) {
      throw new BadRequestException("이 필드는 값 목록을 지원하지 않습니다.");
    }
    if (fieldKey === "usage") {
      const rows = await this.auctionRepo
        .createQueryBuilder("a")
        .select("DISTINCT a.usage", "usage")
        .where("a.usage IS NOT NULL AND a.usage != ''")
        .orderBy("a.usage", "ASC")
        .getRawMany<{ usage: string }>();
      return rows.map((r) => r.usage).filter(Boolean);
    }
    if (fieldKey === "special_note") {
      // 특이사항은 물건마다 자유 문장이라 DISTINCT 조회로는 드롭박스를 만들 수
      // 없다 — 크롤러 화면의 "특수조건" 체크박스 라벨을 그대로 재사용한다.
      return SPECIAL_NOTE_KEYWORD_OPTIONS;
    }
    return [];
  }
}
