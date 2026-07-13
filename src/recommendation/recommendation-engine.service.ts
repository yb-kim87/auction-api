import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { AuctionStatus } from "../common/constants";
import { UsersService } from "../users/users.service";
import { LoanPolicyService } from "../loan-policy/loan-policy.service";
import { RegulatedRegionService, isRegulatedArea } from "../loan-policy/regulated-region.service";
import { ItemAiTag } from "../ai-platform/tag-engine/item-ai-tag.entity";
import {
  parseMoneyToWon,
  requiredEquityForItem,
  selectLoanPolicy,
} from "./investment-math.util";

const PRICE_MERIT_TAG = "가격메리트검토";

export interface RecommendationCriteria {
  investableWon: number;
  housingCount: number;
  firstTimeBuyer: boolean;
}

@Injectable()
export class RecommendationEngineService {
  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(ItemAiTag)
    private readonly tagRepo: Repository<ItemAiTag>,
    private readonly usersService: UsersService,
    private readonly loanPolicyService: LoanPolicyService,
    private readonly regulatedRegionService: RegulatedRegionService,
  ) {}

  /**
   * 회원정보(Investment Strategy) → 대출정책(Policy Engine) → 조건 필터+랭킹(Recommendation Engine)
   * 순으로 추천 리스트를 만든다. AI는 이 순서를 바꾸지 않는다(가격메리트 태그는 동률 시 보조 신호로만 사용).
   */
  async buildCriteriaForUser(
    username: string,
    overrideInvestableWon?: number,
  ): Promise<RecommendationCriteria | null> {
    const user = await this.usersService.findByUsername(username);
    if (!user) return null;

    const investableWon =
      overrideInvestableWon ?? parseMoneyToWon(user.investableFunds ?? "");
    if (investableWon == null || investableWon <= 0) return null;

    return {
      investableWon,
      housingCount: user.housingCount ?? 0,
      firstTimeBuyer: user.firstTimeBuyer ?? false,
    };
  }

  async getRecommendations(
    username: string,
    options?: { overrideInvestableWon?: number; limit?: number },
  ): Promise<{
    items: Auction[];
    criteria: RecommendationCriteria | null;
    // 물건마다 규제지역 여부가 달라 적용 정책이 다를 수 있어, 대표값은 더 이상
    // 단일하지 않다. 물건별 정보는 각 item에 부가 필드로 함께 내려준다
    // (아래 loanRatioByItemId/loanPolicyLabelByItemId 참고).
    loanRatio: number | null;
    loanPolicyLabel: string | null;
    loanInfoByItemId: Record<
      string,
      { loanRatio: number; appraisalRatio: number; loanPolicyLabel: string; requiredEquity: number }
    >;
  }> {
    const criteria = await this.buildCriteriaForUser(username, options?.overrideInvestableWon);
    if (!criteria) {
      return { items: [], criteria: null, loanRatio: null, loanPolicyLabel: null, loanInfoByItemId: {} };
    }

    const policies = await this.loanPolicyService.findAll();
    const regionNames = await this.regulatedRegionService.findAllNames();

    const auctions = await this.auctionRepo.find({
      where: { status: AuctionStatus.APPROVED },
      order: { createdAt: "DESC" },
    });

    const loanInfoByItemId: Record<
      string,
      { loanRatio: number; appraisalRatio: number; loanPolicyLabel: string; requiredEquity: number }
    > = {};
    const affordable = auctions
      .map((item) => {
        const regulated = isRegulatedArea(item.city, item.district, regionNames);
        const policy = selectLoanPolicy(criteria, regulated, policies);
        const requiredEquity = policy
          ? requiredEquityForItem(item.minPrice, item.appraisedValue, policy)
          : item.minPrice;
        if (policy) {
          loanInfoByItemId[item.id] = {
            loanRatio: policy.loanRatio,
            appraisalRatio: policy.appraisalRatio,
            loanPolicyLabel: policy.label,
            requiredEquity,
          };
        }
        return { item, requiredEquity, policy };
      })
      .filter(
        (row) =>
          row.item.minPrice > 0 &&
          row.policy &&
          !row.policy.loanUnavailable &&
          row.requiredEquity <= criteria.investableWon,
      );

    const priceMeritIds = await this.findPriceMeritItemIds(affordable.map((row) => row.item.id));

    affordable.sort((a, b) => {
      // 예산 내에서 가장 비싼(가장 좋은) 물건을 우선 추천
      if (b.requiredEquity !== a.requiredEquity) return b.requiredEquity - a.requiredEquity;
      // 동률일 때만 가격메리트 태그를 보조 신호로 사용
      const meritA = priceMeritIds.has(a.item.id) ? 1 : 0;
      const meritB = priceMeritIds.has(b.item.id) ? 1 : 0;
      if (meritA !== meritB) return meritB - meritA;
      return b.item.createdAt.getTime() - a.item.createdAt.getTime();
    });

    const limited = options?.limit != null ? affordable.slice(0, options.limit) : affordable;
    // 대표 정책(무주택 기준)은 헤더 요약 문구 등 물건과 무관한 표시에만 사용한다.
    const fallbackPolicy = selectLoanPolicy(criteria, false, policies);
    return {
      items: limited.map((row) => row.item),
      criteria,
      loanRatio: fallbackPolicy?.loanRatio ?? null,
      loanPolicyLabel: fallbackPolicy?.label ?? null,
      loanInfoByItemId,
    };
  }

  private async findPriceMeritItemIds(itemIds: string[]): Promise<Set<string>> {
    if (itemIds.length === 0) return new Set();
    const rows = await this.tagRepo.find({ where: { itemId: In(itemIds) } });
    const ids = new Set<string>();
    for (const row of rows) {
      try {
        const finalTags: string[] = JSON.parse(row.finalTags);
        if (finalTags.includes(PRICE_MERIT_TAG)) ids.add(row.itemId);
      } catch {
        // 태그 파싱 실패는 무시(추천 자체는 계속 진행)
      }
    }
    return ids;
  }
}
