/** 규칙 기반 생성 confidence. 향후 AI(OpenAI 등) 생성 태그는 더 낮은 값(예: 80)을 사용한다. */
export const RULE_BASED_CONFIDENCE = 100;

export interface TagEngineOutput {
  autoTags: string[];
  sources: Record<string, string>;
}
