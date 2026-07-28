import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { RightsAnalysisRule } from "./rights-rule.entity";

type RuleOption = { value: string; label: string; description: string };

type RuleDefinition = {
  code: string;
  title: string;
  description: string;
  legalBasis: string;
  defaultValue: string;
  options: RuleOption[];
  editable: boolean;
  sortOrder: number;
};

const RULE_DEFINITIONS: RuleDefinition[] = [
  {
    code: "tenant_opposability_effective_timing",
    title: "임차인 대항력 발생 시점",
    description:
      "전입일(상가는 사업자등록 신청일)과 말소기준권리일이 같을 때의 선후순위를 결정합니다.",
    legalBasis:
      "주택임대차보호법 제3조 및 상가건물 임대차보호법 제3조: 현재는 요건을 마친 다음 날부터 제3자에 대한 효력이 발생합니다.",
    defaultValue: "next_day",
    options: [
      {
        value: "next_day",
        label: "다음 날 0시부터",
        description: "같은 날짜의 말소기준권리보다 후순위로 판정합니다.",
      },
      {
        value: "immediate",
        label: "요건 충족 즉시",
        description: "같은 날짜는 정확한 시각이 없으면 선후순위를 미확인으로 둡니다.",
      },
    ],
    editable: true,
    sortOrder: 10,
  },
  {
    code: "no_investigated_tenant_policy",
    title: "조사된 임차내역 없음 처리",
    description:
      "법원 조사자료에 임차내역 없음이 명시되고 충돌 자료가 없을 때의 판정 방식입니다.",
    legalBasis:
      "현황조사서·전입세대 확인 결과를 임차인 권리 판단 자료로 사용하되 실제 점유·명도 상태와 분리합니다.",
    defaultValue: "auto_none",
    options: [
      {
        value: "auto_none",
        label: "임차인 권리 없음",
        description: "선순위 임차인·대항력·임차보증금 인수를 없음으로 판정합니다.",
      },
      {
        value: "manual_review",
        label: "추가 확인 필요",
        description: "자동 확정하지 않고 임차인 관련 자료를 미확인으로 유지합니다.",
      },
    ],
    editable: true,
    sortOrder: 20,
  },
  {
    code: "claim_amount_is_not_assumption",
    title: "채권·청구금액과 인수금액 분리",
    description:
      "채권금액·채권최고액·경매 청구금액을 낙찰자 인수금액으로 직접 합산하지 않습니다.",
    legalBasis: "실제 인수금액은 권리의 소멸 여부, 배당액과 잔존채권을 기준으로 판단합니다.",
    defaultValue: "enforced",
    options: [{ value: "enforced", label: "항상 적용", description: "안전상 변경할 수 없습니다." }],
    editable: false,
    sortOrder: 30,
  },
  {
    code: "same_day_without_time_policy",
    title: "즉시 효력 규칙의 동일 날짜 자료",
    description:
      "효력이 즉시 발생하도록 법령이 바뀐 경우에도 시각 정보가 없는 동일 날짜 자료는 임의로 선순위를 확정하지 않습니다.",
    legalBasis: "날짜만으로 접수·요건 충족의 시간적 선후를 확인할 수 없는 경우를 위한 안전 규칙입니다.",
    defaultValue: "unknown",
    options: [{ value: "unknown", label: "선후순위 미확인", description: "안전상 변경할 수 없습니다." }],
    editable: false,
    sortOrder: 40,
  },
];

@Injectable()
export class RightsRuleService {
  constructor(
    @InjectRepository(RightsAnalysisRule)
    private readonly ruleRepo: Repository<RightsAnalysisRule>,
  ) {}

  async findAll() {
    const saved = new Map(
      (await this.ruleRepo.find()).map((item) => [item.code, item]),
    );
    return RULE_DEFINITIONS.sort((a, b) => a.sortOrder - b.sortOrder).map(
      (definition) => {
        const row = saved.get(definition.code);
        return {
          ...definition,
          value: row?.value ?? definition.defaultValue,
          updatedBy: row?.updatedBy ?? "",
          updatedAt: row?.updatedAt ?? null,
        };
      },
    );
  }

  async getSettings() {
    const rules = await this.findAll();
    const value = (code: string) =>
      rules.find((rule) => rule.code === code)?.value;
    return {
      tenantEffectiveTiming:
        value("tenant_opposability_effective_timing") === "immediate"
          ? ("immediate" as const)
          : ("next_day" as const),
      noInvestigatedTenantPolicy:
        value("no_investigated_tenant_policy") === "manual_review"
          ? ("manual_review" as const)
          : ("auto_none" as const),
    };
  }

  async update(code: string, nextValue: string, username: string) {
    const definition = RULE_DEFINITIONS.find((rule) => rule.code === code);
    if (!definition) throw new NotFoundException("권리분석 규칙을 찾을 수 없습니다.");
    if (!definition.editable) {
      throw new BadRequestException("이 규칙은 안전상 화면에서 변경할 수 없습니다.");
    }
    if (!definition.options.some((option) => option.value === nextValue)) {
      throw new BadRequestException("허용되지 않은 규칙 값입니다.");
    }
    const existing = await this.ruleRepo.findOne({ where: { code } });
    const row =
      existing ??
      this.ruleRepo.create({
        code,
        value: definition.defaultValue,
        updatedBy: "",
      });
    row.value = nextValue;
    row.updatedBy = username;
    await this.ruleRepo.save(row);
    return (await this.findAll()).find((rule) => rule.code === code);
  }
}
