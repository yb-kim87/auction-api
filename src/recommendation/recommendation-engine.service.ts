import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { AuctionStatus } from "../common/constants";
import { UsersService } from "../users/users.service";
import { LoanPolicyService } from "../loan-policy/loan-policy.service";
import { ItemAiTag } from "../ai-platform/tag-engine/item-ai-tag.entity";
import {
  parseMoneyToWon,
  requiredEquityForMinPrice,
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
    loanRatio: number | null;
    loanPolicyLabel: string | null;
  }> {
    const criteria = await this.buildCriteriaForUser(username, options?.overrideInvestableWon);
    if (!criteria) return { items: [], criteria: null, loanRatio: null, loanPolicyLabel: null };

    const policies = await this.loanPolicyService.findAll();
    const policy = selectLoanPolicy(criteria, policies);
    const loanRatio = policy?.loanRatio ?? 0.7;

    const auctions = await this.auctionRepo.find({
      where: { status: AuctionStatus.APPROVED },
      order: { createdAt: "DESC" },
    });

    const affordable = auctions
      .map((item) => ({
        item,
        requiredEquity: requiredEquityForMinPrice(item.minPrice, loanRatio),
      }))
      .filter((row) => row.item.minPrice > 0 && row.requiredEquity <= criteria.investableWon);

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
    return {
      items: limited.map((row) => row.item),
      criteria,
      loanRatio,
      loanPolicyLabel: policy?.label ?? null,
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
