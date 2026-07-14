import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { AuctionStatus } from "../common/constants";
import { UsersService } from "../users/users.service";
import { LoanPolicyService } from "../loan-policy/loan-policy.service";
import { RegulatedRegionService, isRegulatedArea } from "../loan-policy/regulated-region.service";
import { FavoritesService } from "../favorites/favorites.service";
import { ItemAiTag } from "../ai-platform/tag-engine/item-ai-tag.entity";
import {
  parseMoneyToWon,
  parseIncomeToWon,
  requiredEquityForItem,
  selectLoanPolicy,
  matchesProgressStatus,
  matchesFailureRateFilter,
  matchesPropertyType,
  needsCreditScoreWarning,
  type ProgressStatus,
} from "./investment-math.util";

const PRICE_MERIT_TAG = "가격메리트검토";

export interface RecommendationCriteria {
  investableWon: number;
  housingCount: number;
  firstTimeBuyer: boolean;
  annualIncomeWon: number | null;
  existingLoanWon: number;
  creditScoreWarning: boolean;
}

export interface RecommendationFilters {
  city?: string;
  propType?: string;
  maxFailureRate?: string;
  favoritesOnly?: boolean;
  progressStatus?: ProgressStatus;
  search?: string;
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
    private readonly favoritesService: FavoritesService,
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
      annualIncomeWon: parseIncomeToWon(user.annualNetIncome),
      existingLoanWon: parseMoneyToWon(user.existingLoanAmount ?? "") ?? 0,
      creditScoreWarning: needsCreditScoreWarning(user.creditScore),
    };
  }

  async getRecommendations(
    username: string,
    options?: {
      overrideInvestableWon?: number;
      limit?: number;
      offset?: number;
      filters?: RecommendationFilters;
    },
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
      {
        loanRatio: number;
        appraisalRatio: number;
        loanPolicyLabel: string;
        requiredEquity: number;
        regulatedArea: boolean;
        incomeLoanLimit: number | null;
        existingLoanWon: number;
      }
    >;
    total: number;
    hasMore: boolean;
    creditScoreWarning: boolean;
  }> {
    const criteria = await this.buildCriteriaForUser(username, options?.overrideInvestableWon);
    if (!criteria) {
      return {
        items: [],
        criteria: null,
        loanRatio: null,
        loanPolicyLabel: null,
        loanInfoByItemId: {},
        total: 0,
        hasMore: false,
        creditScoreWarning: false,
      };
    }

    const policies = await this.loanPolicyService.findAll();
    const regionNames = await this.regulatedRegionService.findAllNames();
    const incomeLoanMultiplier = await this.loanPolicyService.getIncomeLoanMultiplier();

    const filters = options?.filters;
    const favoriteIds =
      filters?.favoritesOnly ? new Set(await this.favoritesService.listAuctionIds(username)) : null;
    const searchQuery = filters?.search?.trim().toLowerCase() || "";

    const auctions = await this.auctionRepo.find({
      where: { status: AuctionStatus.APPROVED },
      order: { createdAt: "DESC" },
    });

    const loanInfoByItemId: Record<
      string,
      {
        loanRatio: number;
        appraisalRatio: number;
        loanPolicyLabel: string;
        requiredEquity: number;
        regulatedArea: boolean;
        incomeLoanLimit: number | null;
        existingLoanWon: number;
      }
    > = {};
    const affordable = auctions
      .map((item) => {
        const regulated = isRegulatedArea(item.city, item.district, regionNames);
        const policy = selectLoanPolicy(criteria, regulated, policies);
        const requiredEquity = policy
          ? requiredEquityForItem(
              item.minPrice,
              item.appraisedValue,
              policy,
              criteria.annualIncomeWon ?? undefined,
              criteria.existingLoanWon,
              incomeLoanMultiplier,
            )
          : item.minPrice;
        if (policy) {
          const incomeLoanLimit =
            criteria.annualIncomeWon != null
              ? Math.max(0, criteria.annualIncomeWon) * incomeLoanMultiplier
              : null;
          loanInfoByItemId[item.id] = {
            loanRatio: policy.loanRatio,
            appraisalRatio: policy.appraisalRatio,
            loanPolicyLabel: policy.label,
            requiredEquity,
            regulatedArea: regulated,
            incomeLoanLimit,
            existingLoanWon: criteria.existingLoanWon,
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
      )
      .filter((row) => {
        if (filters?.city && row.item.city !== filters.city) return false;
        if (filters?.propType && !matchesPropertyType(row.item, filters.propType)) return false;
        if (
          filters?.maxFailureRate &&
          !matchesFailureRateFilter(row.item.minPrice, row.item.appraisedValue, filters.maxFailureRate)
        ) {
          return false;
        }
        if (favoriteIds && !favoriteIds.has(row.item.id)) return false;
        if (
          filters?.progressStatus &&
          !matchesProgressStatus(row.item.bidDate, filters.progressStatus)
        ) {
          return false;
        }
        if (searchQuery) {
          const matchesText =
            row.item.address?.toLowerCase().includes(searchQuery) ||
            row.item.auctionNo?.toLowerCase().includes(searchQuery);
          if (!matchesText) return false;
        }
        return true;
      });

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

    const offset = options?.offset ?? 0;
    const page =
      options?.limit != null ? affordable.slice(offset, offset + options.limit) : affordable.slice(offset);
    // 대표 정책(무주택 기준)은 헤더 요약 문구 등 물건과 무관한 표시에만 사용한다.
    const fallbackPolicy = selectLoanPolicy(criteria, false, policies);
    return {
      items: page.map((row) => row.item),
      criteria,
      loanRatio: fallbackPolicy?.loanRatio ?? null,
      loanPolicyLabel: fallbackPolicy?.label ?? null,
      loanInfoByItemId,
      total: affordable.length,
      hasMore: offset + page.length < affordable.length,
      creditScoreWarning: criteria.creditScoreWarning,
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
