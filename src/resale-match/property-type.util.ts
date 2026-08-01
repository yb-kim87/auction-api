/**
 * 프론트 검색 필터(`young/auction/src/data/property-type-options.ts`)의
 * matchesPropertyType과 동일한 규칙을 백엔드에서도 써야 해서 이식했다.
 * 프론트 전용 `@/data` 모듈이라 그대로 import할 수 없어 로직만 복제 —
 * 두 파일 중 하나가 바뀌면 다른 쪽도 같이 갱신해야 한다.
 */
const VILLA_USAGE_SET = new Set(["다세대주택", "도시형생활주택", "연립주택"]);

export function matchesPropertyType(
  item: { usage: string; propType: string },
  selected: string,
): boolean {
  if (!selected) return true;
  if (selected === "아파트") return item.usage === "아파트";
  if (selected === "빌라") return VILLA_USAGE_SET.has(item.usage) || item.propType === "빌라";
  return item.usage === selected;
}
