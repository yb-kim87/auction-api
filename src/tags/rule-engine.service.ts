import { Injectable } from "@nestjs/common";
import { Auction } from "../auctions/auction.entity";
import { TagRule } from "./tag-rule.entity";
import { StrategyRule } from "./strategy-rule.entity";
import { RULE_FIELD_MAP } from "./rule-field-registry";

/** 규칙 하나(활성 상태의 field/operator/value)가 이 물건에 해당하는지 평가한다 */
function evaluateRule(item: Auction, rule: TagRule): boolean {
  const field = RULE_FIELD_MAP.get(rule.field);
  if (!field) return false;

  const actual = field.extract(item);
  if (actual == null) return false;

  switch (rule.operator) {
    case "gt":
      return typeof actual === "number" && actual > Number(rule.value);
    case "gte":
      return typeof actual === "number" && actual >= Number(rule.value);
    case "lt":
      return typeof actual === "number" && actual < Number(rule.value);
    case "lte":
      return typeof actual === "number" && actual <= Number(rule.value);
    case "eq":
      return String(actual) === rule.value;
    case "neq":
      return String(actual) !== rule.value;
    case "contains":
      return typeof actual === "string" && actual.includes(rule.value);
    case "in":
      return (
        typeof actual === "string" &&
        rule.value
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
          .includes(actual)
      );
    default:
      return false;
  }
}

function parseFactCodes(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

@Injectable()
export class RuleEngineService {
  /**
   * 활성 fact 규칙들을 물건 하나에 적용해 Fact 코드 배열을 만든다(사용자 비노출,
   * 내부 판단용). 규칙 여러 개가 같은 코드를 만들면 중복 제거하고 sortOrder 순서를 유지한다.
   */
  computeFactCodes(item: Auction, rules: TagRule[]): string[] {
    const codes: string[] = [];
    for (const rule of rules) {
      if (!rule.active || rule.category !== "fact") continue;
      if (evaluateRule(item, rule)) {
        if (!codes.includes(rule.tagCode)) codes.push(rule.tagCode);
      }
    }
    return codes;
  }

  /**
   * Fact 코드 집합을 보고, requiredFactCodes를 모두 만족하는 StrategyRule의 strategyCode를
   * 부여한다(사용자 비노출 코드 — 실제 문구는 StrategyLabel이 담당).
   */
  computeStrategyCodes(factCodes: string[], strategyRules: StrategyRule[]): string[] {
    const factSet = new Set(factCodes);
    const codes: string[] = [];
    for (const rule of strategyRules) {
      if (!rule.active) continue;
      const required = parseFactCodes(rule.requiredFactCodes);
      if (required.length === 0) continue;
      const matched = required.every((code) => factSet.has(code));
      if (matched && !codes.includes(rule.strategyCode)) codes.push(rule.strategyCode);
    }
    return codes;
  }
}
