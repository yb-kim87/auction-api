import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { AuctionStatus, UserRole } from "../common/constants";
import { UsersService } from "../users/users.service";
import { AuctionAnalysis } from "./auction-analysis.entity";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiService } from "./openai.service";

const ANALYSIS_ENGINE_LABEL = "경매코치 AI";

const SYSTEM_PROMPT = `당신은 ${ANALYSIS_ENGINE_LABEL} — 한국 법원 경매 부동산 분석 전문가입니다.
제공된 [내부 경매지식]을 최우선 기준으로 분석하세요.
물건 데이터와 회원 투자정보를 함께 반영하세요.
법률·금융 조언은 참고 수준이며, 반드시 전문가 확인이 필요함을 전제로 작성합니다.
제공되지 않은 수치를 임의로 만들지 마세요. 없으면 "정보 없음"이라고 하세요.
GPT, OpenAI 등 외부 AI 서비스명은 사용자에게 언급하지 마세요.

반드시 아래 JSON 키만 사용하세요:
{
  "summary": "한 줄 요약",
  "priceAnalysis": "가격·시세·낙찰가 관점 분석",
  "rightsAnalysis": "등기·임차·특수권리 등 권리분석",
  "loanAnalysis": "대출·LTV·자금조달 관점 (회원 투자정보 반영)",
  "investmentFit": "회원 투자목표·목표수익 대비 적합도",
  "checklist": ["입찰 전 확인사항1", "..."],
  "recommendation": "관망 | 검토 | 적극 검토 중 하나",
  "risks": ["주요 리스크1", "..."]
}`;

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function auctionSnapshotAt(auction: Auction): Date {
  return auction.updatedAt ?? auction.createdAt;
}

@Injectable()
export class AiAnalysisService {
  constructor(
    @InjectRepository(Auction)
    private readonly auctionRepo: Repository<Auction>,
    @InjectRepository(AuctionAnalysis)
    private readonly analysisRepo: Repository<AuctionAnalysis>,
    private readonly usersService: UsersService,
    private readonly knowledgeService: KnowledgeService,
    private readonly openAi: OpenAiService,
  ) {}

  private async findAuction(id: string, role: UserRole | "") {
    const item = await this.auctionRepo.findOne({ where: { id } });
    if (!item) {
      throw new NotFoundException("물건을 찾을 수 없습니다.");
    }
    if (role !== UserRole.ADMIN && item.status !== AuctionStatus.APPROVED) {
      throw new ForbiddenException("승인된 물건만 분석할 수 있습니다.");
    }
    return item;
  }

  private buildUserPrompt(
    auction: Auction,
    user: Awaited<ReturnType<UsersService["findByUsername"]>>,
    knowledgeBlock: string,
  ) {
    const profileBlock = user
      ? `
[회원 투자정보]
- 이름: ${user.name}
- 투자가능자금: ${user.investableFunds || "미입력"}
- 기존대출금액: ${user.existingLoanAmount || "미입력"}
- 주택수: ${user.housingCount ?? 0}
- 목표 수익: ${user.targetReturn || "미입력"}
- 투자목표: ${user.investmentGoal || "미입력"}`
      : "[회원 투자정보] 없음";

    return `${knowledgeBlock}

${profileBlock}

[물건 기본]
- 사건번호: ${auction.auctionNo}
- 주소: ${auction.address}
- 유형: ${auction.propType} / ${auction.usage}
- 면적: ${auction.area}
- 준공: ${auction.builtYear || "-"}
- 입찰일: ${auction.bidDate}

[가격]
- 감정가: ${fmt(auction.appraisedValue)}원
- 최저가: ${fmt(auction.minPrice)}원
- 매각가: ${auction.salePrice != null ? `${fmt(auction.salePrice)}원` : "없음"}
- 네이버 시세: ${auction.naverPrice ? `${fmt(auction.naverPrice)}원` : "없음"}
- 네이버 대비 최저가 차: ${fmt(auction.diffNaverMin)}원
- 네이버 대비 감정가 차: ${fmt(auction.diffNaverAppraised)}원

[물건 상세]
- 승강기/주차: ${auction.elevator} / ${auction.parking}
- 대지지분: ${auction.landShare || "-"}
- 교육: ${auction.education || "-"}
- 거래건수: ${auction.tradingCount || "-"}
- 소유자: ${auction.owner || "-"}
- 감정평가: ${auction.appraiser || "-"}
- 공시지가: ${auction.officialLandPrice ? `${fmt(auction.officialLandPrice)}원` : "-"}

[권리·임차]
- 등기부: ${auction.buildingRegistry || "없음"}
- 임차인: ${auction.tenantInfo || "없음"}
- 임차 상세: ${auction.tenantDetail || "없음"}
- 특이사항: ${auction.specialNote || "없음"}

[기타]
- 입찰정보: ${auction.bidInfo || "-"}
- 가격 상세: ${auction.priceDetail || "-"}
- 거래 상세: ${auction.tradingDetail || "-"}
- 메모: ${auction.memo || "-"}

위 정보와 [내부 경매지식]을 바탕으로 권리분석, 물건분석, 대출·자금 관점을 포함해 분석해 주세요.`;
  }

  private async isAnalysisStale(row: AuctionAnalysis, auction: Auction | null) {
    const auctionStale =
      auction &&
      row.auctionSnapshotAt &&
      auctionSnapshotAt(auction).getTime() > row.auctionSnapshotAt.getTime();

    const knowledgeMax = await this.knowledgeService.getActiveKnowledgeMaxUpdatedAt();
    const knowledgeStale =
      knowledgeMax &&
      row.knowledgeMaxUpdatedAt &&
      knowledgeMax.getTime() > row.knowledgeMaxUpdatedAt.getTime();

    return Boolean(auctionStale || knowledgeStale);
  }

  private parseResult(row: AuctionAnalysis, extra: { cached?: boolean; stale?: boolean }) {
    return {
      id: row.id,
      auctionId: row.auctionId,
      model: row.model,
      createdAt: row.createdAt,
      ...extra,
      ...JSON.parse(row.resultJson),
    };
  }

  async getLatest(auctionId: string, username: string) {
    const row = await this.analysisRepo.findOne({
      where: { auctionId, username },
      order: { createdAt: "DESC" },
    });
    if (!row) return null;

    const auction = await this.auctionRepo.findOne({ where: { id: auctionId } });
    const stale = await this.isAnalysisStale(row, auction);

    return this.parseResult(row, { cached: !stale, stale });
  }

  async analyze(
    auctionId: string,
    username: string,
    role: UserRole | "",
    refresh = false,
  ) {
    const auction = await this.findAuction(auctionId, role);
    const snapshot = auctionSnapshotAt(auction);
    const knowledgeMaxUpdatedAt =
      await this.knowledgeService.getActiveKnowledgeMaxUpdatedAt();

    if (!refresh) {
      const existing = await this.analysisRepo.findOne({
        where: { auctionId, username },
        order: { createdAt: "DESC" },
      });
      if (existing?.auctionSnapshotAt) {
        const stale = await this.isAnalysisStale(existing, auction);
        if (!stale && existing.auctionSnapshotAt.getTime() >= snapshot.getTime()) {
          return this.parseResult(existing, { cached: true, stale: false });
        }
      }
    }

    const knowledgeItems = await this.knowledgeService.searchForAuction(auction);
    const knowledgeBlock = this.knowledgeService.formatForPrompt(knowledgeItems);
    const citations = knowledgeItems.map((k) =>
      k.category ? `[${k.category}] ${k.title}` : k.title,
    );

    const user = username
      ? await this.usersService.findByUsername(username)
      : null;
    const userPrompt = this.buildUserPrompt(auction, user, knowledgeBlock);

    const llm = await this.openAi.analyzeAuction(SYSTEM_PROMPT, userPrompt);

    const resultPayload = {
      ...llm,
      citations,
      knowledgeCount: knowledgeItems.length,
    };

    const saved = await this.analysisRepo.save(
      this.analysisRepo.create({
        auctionId,
        username,
        resultJson: JSON.stringify(resultPayload),
        model: ANALYSIS_ENGINE_LABEL,
        auctionSnapshotAt: snapshot,
        knowledgeMaxUpdatedAt,
      }),
    );

    return this.parseResult(saved, { cached: false, stale: false });
  }
}
