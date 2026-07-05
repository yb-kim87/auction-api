import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { UsersService } from "../users/users.service";
import { OpenAiService } from "./openai.service";
import { RecommendationEngineService } from "../recommendation/recommendation-engine.service";
import { parseMoneyToWon } from "../recommendation/investment-math.util";

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function auctionLine(a: Auction): string {
  return `- ${a.auctionNo} | ${a.address} | ${a.usage} | 최저가 ${fmt(a.minPrice)}원 | 감정가 ${fmt(a.appraisedValue)}원`;
}

@Injectable()
export class AiAssistantService {
  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    private readonly usersService: UsersService,
    private readonly openAi: OpenAiService,
    private readonly recommendationEngine: RecommendationEngineService,
  ) {}

  /**
   * 자유 질문 응답. auctionId가 있으면 그 물건 기준, 없으면 예산 언급을 파싱해
   * Recommendation Engine을 다시 돌려 실제 후보 목록을 근거로 답한다(임의 물건 생성 금지).
   */
  async ask(username: string, question: string, auctionId?: string) {
    const trimmed = question.trim();
    if (!trimmed) {
      throw new BadRequestException("질문을 입력해 주세요.");
    }

    const user = await this.usersService.findByUsername(username);

    if (auctionId) {
      const auction = await this.auctionRepo.findOne({ where: { id: auctionId } });
      if (!auction) throw new NotFoundException("물건을 찾을 수 없습니다.");

      const systemPrompt = `당신은 "경매코치 AI"입니다. 아래 [물건 정보]만 근거로 사용자의 질문에 한국어로 간결하게 답하세요.
제공되지 않은 수치는 임의로 만들지 말고 "정보 없음"이라고 답하세요. 법률·금융 조언은 참고 수준임을 전제로 합니다.`;
      const userPrompt = `[물건 정보]\n${auctionLine(auction)}\n입찰기일: ${auction.bidDate}\n권리분석 메모: ${auction.specialNote || "없음"}\n임차정보: ${auction.tenantInfo || "없음"}\n\n[질문]\n${trimmed}`;
      const answer = await this.openAi.answerFreeform(systemPrompt, userPrompt);
      return { answer };
    }

    const budgetWon = parseMoneyToWon(trimmed);
    const { items, criteria } = await this.recommendationEngine.getRecommendations(username, {
      overrideInvestableWon: budgetWon ?? undefined,
      limit: 10,
    });

    const profileBlock = user
      ? `투자가능자금: ${user.investableFunds || "미입력"}, 주택수: ${user.housingCount ?? 0}, 생애최초: ${user.firstTimeBuyer ? "예" : "아니오"}`
      : "회원 투자정보 없음";

    const candidateBlock =
      items.length > 0
        ? items.slice(0, 10).map(auctionLine).join("\n")
        : "조건에 맞는 후보 물건 없음";

    const systemPrompt = `당신은 "경매코치 AI"입니다. 아래 [추천 후보 물건] 목록에 있는 물건만 언급하세요.
목록에 없는 물건을 지어내지 마세요. 사용자의 질문이 예산/조건 관련이면 후보 중 적합한 것을 한국어로 안내하세요.`;
    const userPrompt = `[회원 투자정보]\n${profileBlock}\n${budgetWon ? `[질문에서 인식한 예산] ${fmt(budgetWon)}원\n` : ""}\n[추천 후보 물건]\n${candidateBlock}\n\n[질문]\n${trimmed}`;

    const answer = await this.openAi.answerFreeform(systemPrompt, userPrompt);
    return { answer, matchedCount: items.length, criteriaApplied: criteria != null };
  }

  async compare(auctionIdA: string, auctionIdB: string) {
    if (auctionIdA === auctionIdB) {
      throw new BadRequestException("서로 다른 물건 2개를 선택해 주세요.");
    }
    const [a, b] = await Promise.all([
      this.auctionRepo.findOne({ where: { id: auctionIdA } }),
      this.auctionRepo.findOne({ where: { id: auctionIdB } }),
    ]);
    if (!a || !b) throw new NotFoundException("물건을 찾을 수 없습니다.");

    const table = {
      a: this.compareRow(a),
      b: this.compareRow(b),
    };

    const systemPrompt = `당신은 "경매코치 AI"입니다. 두 경매 물건을 비교해 어느 쪽이 더 나은 선택인지 간단히 안내하세요.
제공된 데이터만 근거로 하고, 반드시 아래 JSON 형식으로만 답하세요:
{"summary": "한 줄 비교 요약", "betterChoice": "A 또는 B 또는 상황에따라다름", "reasons": ["이유1", "이유2"]}`;
    const userPrompt = `[물건 A]\n${auctionLine(a)}\n\n[물건 B]\n${auctionLine(b)}`;

    let ai: { summary: string; betterChoice: string; reasons: string[] } | null = null;
    try {
      ai = await this.openAi.compareAuctions(systemPrompt, userPrompt);
    } catch {
      ai = null;
    }

    return { table, ai };
  }

  private compareRow(a: Auction) {
    return {
      id: a.id,
      auctionNo: a.auctionNo,
      address: a.address,
      usage: a.usage,
      area: a.area,
      appraisedValue: a.appraisedValue,
      minPrice: a.minPrice,
      naverPrice: a.naverPrice,
      naverPriceFloorLabel: a.naverPriceFloorLabel,
      bidDate: a.bidDate,
    };
  }
}
