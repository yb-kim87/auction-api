import { Injectable } from "@nestjs/common";
import { Auction } from "../auctions/auction.entity";
import { TagRule } from "./tag-rule.entity";
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
    default:
      return false;
  }
}

@Injectable()
export class RuleEngineService {
  /**
   * 활성 fact 규칙들을 물건 하나에 적용해 태그명 배열을 만든다. 규칙 여러 개가 같은
   * 태그명을 만들면 중복 제거한다. sortOrder 순서를 그대로 유지한다.
   */
  computeFactTags(item: Auction, rules: TagRule[]): string[] {
    const tags: string[] = [];
    for (const rule of rules) {
      if (!rule.active || rule.category !== "fact") continue;
      if (evaluateRule(item, rule)) {
        if (!tags.includes(rule.tagName)) tags.push(rule.tagName);
      }
    }
    return tags;
  }
}
