export type AiPlatformEngineType =
  | "normalizer"
  | "feature"
  | "tag"
  // 향후 확장 예정 엔진
  | "score"
  | "recommendation"
  | "user_memory"
  | "reason"
  | "rights"
  | "bid";

export type AiPlatformActionType =
  | "auto_generate"
  | "manual_update"
  | "regenerate";

/** 각 엔진 결과가 공통으로 갖는 형태. sources는 "왜 이 값이 나왔는지"를 항상 남긴다. */
export interface AiEngineRunResult<TData extends object> {
  itemId: string;
  data: TData;
  sources: Record<string, unknown>;
  version: number;
}

export interface AiEngineRunContext {
  changedBy: string;
  actionType: AiPlatformActionType;
}

/**
 * 모든 AI Platform 엔진(Normalizer/Feature/Tag/향후 Score 등)이 구현하는 공통 계약.
 * 새 엔진을 추가할 때는 이 인터페이스만 구현하면 파이프라인에 그대로 연결할 수 있다.
 */
export interface AiEngine<TInput, TData extends object> {
  readonly engineType: AiPlatformEngineType;
  runForItem(
    itemId: string,
    input: TInput,
    ctx: AiEngineRunContext,
  ): Promise<AiEngineRunResult<TData>>;
}
