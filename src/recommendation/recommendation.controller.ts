import { Controller, Get, Headers, Query } from "@nestjs/common";
import { getAuthContext, requireSearchAccess } from "../common/auth-context";
import { RecommendationEngineService } from "./recommendation-engine.service";
import { parseMoneyToWon } from "./investment-math.util";

@Controller("recommendations")
export class RecommendationController {
  constructor(private readonly recommendationEngine: RecommendationEngineService) {}

  @Get()
  async getRecommendations(
    @Headers() headers: Record<string, string>,
    @Query("budget") budget?: string,
  ) {
    const ctx = getAuthContext(headers);
    requireSearchAccess(ctx);

    const overrideInvestableWon = budget ? parseMoneyToWon(budget) ?? undefined : undefined;
    const result = await this.recommendationEngine.getRecommendations(ctx.username, {
      overrideInvestableWon,
    });

    return {
      items: result.items,
      hasCriteria: result.criteria != null,
      loanRatio: result.loanRatio,
      loanPolicyLabel: result.loanPolicyLabel,
    };
  }
}
