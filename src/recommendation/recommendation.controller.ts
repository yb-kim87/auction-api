import { Controller, Get, Headers, Query } from "@nestjs/common";
import { getAuthContext, requireSearchAccess } from "../common/auth-context";
import { RecommendationEngineService } from "./recommendation-engine.service";
import { parseMoneyToWon, type ProgressStatus } from "./investment-math.util";

const VALID_PROGRESS_STATUS = new Set(["all", "active", "ended"]);

@Controller("recommendations")
export class RecommendationController {
  constructor(private readonly recommendationEngine: RecommendationEngineService) {}

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
  ) {
    const ctx = getAuthContext(headers);
    requireSearchAccess(ctx);

    const overrideInvestableWon = budget ? parseMoneyToWon(budget) ?? undefined : undefined;
    const result = await this.recommendationEngine.getRecommendations(ctx.username, {
      overrideInvestableWon,
      limit: limit ? Math.min(100, Math.max(1, Number(limit) || 30)) : undefined,
      offset: offset ? Math.max(0, Number(offset) || 0) : undefined,
      filters: {
        city: city || undefined,
        propType: propType || undefined,
        maxFailureRate: maxFailureRate || undefined,
        favoritesOnly: favoritesOnly === "true",
        progressStatus: VALID_PROGRESS_STATUS.has(progressStatus ?? "")
          ? (progressStatus as ProgressStatus)
          : undefined,
        search: search || undefined,
      },
    });

    return {
      items: result.items,
      hasCriteria: result.criteria != null,
      loanRatio: result.loanRatio,
      loanPolicyLabel: result.loanPolicyLabel,
      loanInfoByItemId: result.loanInfoByItemId,
      total: result.total,
      hasMore: result.hasMore,
      creditScoreWarning: result.creditScoreWarning,
    };
  }
}
