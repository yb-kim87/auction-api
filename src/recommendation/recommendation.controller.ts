import { Controller, Get, Headers, Query } from "@nestjs/common";
import { getAuthContext, requireSearchAccess } from "../common/auth-context";
import { RecommendationEngineService } from "./recommendation-engine.service";
import { parseMoneyToWon, type ProgressStatus } from "./investment-math.util";
import { TagsService } from "../tags/tags.service";
import { UserRole } from "../common/constants";
import { stripResaleMatchFields, stripStaffOnlyAuctionFields } from "../auctions/auction-staff-fields.util";

const VALID_PROGRESS_STATUS = new Set(["all", "active", "ended"]);

/** 지역/물건종류/투자전략 필터는 콤마로 구분된 다중 값을 받는다
 * (사용자 요청: 상세 필터에서 중복 선택 가능하게, 2026-07-23). */
function parseMultiValue(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

@Controller("recommendations")
export class RecommendationController {
  constructor(
    private readonly recommendationEngine: RecommendationEngineService,
    private readonly tagsService: TagsService,
  ) {}

  @Get()
  async getRecommendations(
    @Headers() headers: Record<string, string>,
    @Query("budget") budget?: string,
    @Query("limit") limit?: string,
    @Query("offset") offset?: string,
    @Query("city") city?: string,
    @Query("propType") propType?: string,
    @Query("maxFailureRate") maxFailureRate?: string,
    @Query("favoritesOnly") favoritesOnly?: string,
    @Query("progressStatus") progressStatus?: string,
    @Query("search") search?: string,
    @Query("strategyLabel") strategyLabel?: string,
    @Query("minArea") minArea?: string,
    @Query("maxArea") maxArea?: string,
  ) {
    const ctx = getAuthContext(headers);
    requireSearchAccess(ctx);

    const overrideInvestableWon = budget ? parseMoneyToWon(budget) ?? undefined : undefined;
    const result = await this.recommendationEngine.getRecommendations(ctx.username, {
      overrideInvestableWon,
      limit: limit ? Math.min(100, Math.max(1, Number(limit) || 30)) : undefined,
      offset: offset ? Math.max(0, Number(offset) || 0) : undefined,
      filters: {
        city: parseMultiValue(city),
        propType: parseMultiValue(propType),
        maxFailureRate: maxFailureRate || undefined,
        favoritesOnly: favoritesOnly === "true",
        progressStatus: VALID_PROGRESS_STATUS.has(progressStatus ?? "")
          ? (progressStatus as ProgressStatus)
          : undefined,
        search: search || undefined,
        strategyLabel: parseMultiValue(strategyLabel),
        minArea: minArea ? Number(minArea) || undefined : undefined,
        maxArea: maxArea ? Number(maxArea) || undefined : undefined,
      },
    });

    const isStaff = ctx.role === UserRole.ADMIN || ctx.role === UserRole.CONSULTANT;
    const isAdmin = ctx.role === UserRole.ADMIN;
    const items = isStaff
      ? result.items.map((item) => (isAdmin ? item : stripResaleMatchFields(item)))
      : result.items.map((item) => stripResaleMatchFields(stripStaffOnlyAuctionFields(item)));

    return {
      items,
      hasCriteria: result.criteria != null,
      loanRatio: result.loanRatio,
      loanPolicyLabel: result.loanPolicyLabel,
      loanInfoByItemId: result.loanInfoByItemId,
      total: result.total,
      hasMore: result.hasMore,
      creditScoreWarning: result.creditScoreWarning,
    };
  }

  /** 추천 물건 화면의 "라벨 필터" 드롭박스를 채울 전략 라벨 전체 목록.
   * 로그인만 되어 있으면 조회 가능(관리자 전용 아님). */
  @Get("strategy-labels")
  async getStrategyLabels(@Headers() headers: Record<string, string>) {
    const ctx = getAuthContext(headers);
    requireSearchAccess(ctx);
    const labels = await this.tagsService.findAllStrategyLabels();
    return labels.map((l) => ({ id: l.id, label: l.label }));
  }
}
