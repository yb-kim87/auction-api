import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createHash } from "node:crypto";
import {
  Auction,
  type AuctionRightsReview,
  type RightsReviewStatus,
} from "../auctions/auction.entity";
import { formatTenantStatusText } from "../auctions/tenant-status.util";
import { AuctionStatus, UserRole } from "../common/constants";
import { UsersService } from "../users/users.service";
import { AuctionAnalysis } from "./auction-analysis.entity";
import { KnowledgeService } from "./knowledge.service";
import { OpenAiService } from "./openai.service";

const ANALYSIS_ENGINE_LABEL = "경매코치 AI";

const SYSTEM_PROMPT = `당신은 ${ANALYSIS_ENGINE_LABEL} — 한국 법원 경매 부동산 분석 전문가입니다.
제공된 [내부 경매지식]을 최우선 기준으로 분석하세요.
물건 자체의 권리관계만 분석하세요. 회원 개인정보·투자금·대출·수익률은 사용하지 마세요.
법률·금융 조언은 참고 수준이며, 반드시 전문가 확인이 필요함을 전제로 작성합니다.
경매 초보자도 이해할 수 있는 짧고 쉬운 문장으로 작성하세요.
전문용어가 꼭 필요하면 해당 문장 안에서 일상적인 말로 뜻을 함께 설명하세요.
제공되지 않은 사실·권리·금액을 추측하지 마세요. 자료가 없으면 "미확인"이라고 명확히 표시하세요.
등기나 임차인 자료가 없는데 일반적인 가능성을 이 물건의 확정 사실처럼 작성하지 마세요.
checklist는 "등기부 발급하기", "전입세대 확인하기"처럼 사용자가 다음에 할 행동으로 작성하세요.
GPT, OpenAI 등 외부 AI 서비스명은 사용자에게 언급하지 마세요.

반드시 아래 JSON 키만 사용하세요:
{
  "summary": "초보자가 이해할 수 있는 한 줄 결론",
  "priceAnalysis": "",
  "rightsAnalysis": "확인된 사실과 미확인 사항을 구분한 쉬운 권리분석",
  "loanAnalysis": "",
  "investmentFit": "",
  "checklist": ["사용자가 다음에 실행할 확인 행동1", "..."],
  "recommendation": "관망 | 검토 | 적극 검토 중 하나",
  "risks": ["주요 리스크1", "..."],
  "structuredRights": {
    "reviewStatus": "unknown | possible | none",
    "baselineRight": {
      "type": "확인된 말소기준권리 종류 또는 빈 문자열",
      "date": "YYYY-MM-DD 또는 빈 문자열",
      "reason": "판단 근거 또는 미확인 이유"
    },
    "tenant": {
      "priorityStatus": "unknown | possible | none",
      "opposability": "unknown | possible | none",
      "depositAmount": "확인된 숫자 또는 null"
    },
    "assumption": {
      "status": "unknown | possible | none",
      "estimatedAmount": "근거로 산정 가능한 숫자 또는 null",
      "reason": "산정 근거 또는 산정 불가 이유"
    },
    "missingEvidence": ["추가로 필요한 자료"],
    "evidence": ["실제로 판단에 사용한 물건별 자료"]
  }
}`;

function fmt(n: number) {
  return n.toLocaleString("ko-KR");
}

function auctionSnapshotAt(auction: Auction): Date {
  return auction.updatedAt ?? auction.createdAt;
}

@Injectable()
export class AiAnalysisService {
  private readonly analysisInFlight = new Map<string, Promise<void>>();

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

  async getRightsReview(auctionId: string, role: UserRole | "") {
    const auction = await this.findAuction(auctionId, role);
    return auction.rightsReview;
  }

  async saveRightsReview(
    auctionId: string,
    username: string,
    role: UserRole | "",
    input: Partial<AuctionRightsReview>,
  ) {
    if (role !== UserRole.ADMIN) {
      throw new ForbiddenException("관리자만 권리분석 확인값을 저장할 수 있습니다.");
    }
    const auction = await this.findAuction(auctionId, role);
    const allowedStatuses: RightsReviewStatus[] = [
      "uninvestigated",
      "in_progress",
      "none",
      "confirmed",
      "unverifiable",
    ];
    const normalizeFinding = (
      value: unknown,
    ): "unknown" | "none" | "possible" | "confirmed" =>
      value === "none" || value === "possible" || value === "confirmed"
        ? value
        : "unknown";
    const nullableAmount = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const amount = Number(value);
      return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
    };
    const status = allowedStatuses.includes(input.status as RightsReviewStatus)
      ? (input.status as RightsReviewStatus)
      : "uninvestigated";
    const review: AuctionRightsReview = {
      status,
      baselineRightType: String(input.baselineRightType ?? "").trim(),
      baselineRightDate: String(input.baselineRightDate ?? "").trim(),
      seniorTenantStatus: normalizeFinding(input.seniorTenantStatus),
      opposabilityStatus: normalizeFinding(input.opposabilityStatus),
      depositAmount: nullableAmount(input.depositAmount),
      expectedDividendAmount: nullableAmount(input.expectedDividendAmount),
      assumptionAmount: nullableAmount(input.assumptionAmount),
      specialRights: String(input.specialRights ?? "").trim(),
      evidenceNote: String(input.evidenceNote ?? "").trim(),
      confirmedAt:
        status === "confirmed" || status === "none"
          ? String(input.confirmedAt ?? "").trim() || new Date().toISOString()
          : "",
      confirmedBy:
        status === "confirmed" || status === "none"
          ? username
          : "",
    };
    auction.rightsReview = review;
    auction.updatedAt = new Date();
    auction.updatedBy = username;
    await this.auctionRepo.save(auction);
    return review;
  }

  private buildAutoRights(llm: Awaited<ReturnType<OpenAiService["analyzeAuction"]>>) {
    const structured = llm.structuredRights;
    if (!structured) {
      return {
        status: "unavailable" as const,
        label: "자동 분석 불가",
        calculationReady: false,
        assumptionAmount: null,
        confidence: "low" as const,
        exceptionReasons: ["구조화된 권리분석 결과가 없습니다."],
      };
    }

    const missingEvidence = structured.missingEvidence.filter(Boolean);
    const possibleRisk =
      structured.reviewStatus === "possible" ||
      structured.tenant.priorityStatus === "possible" ||
      structured.tenant.opposability === "possible" ||
      structured.assumption.status === "possible";
    const amount =
      structured.assumption.status === "none"
        ? 0
        : structured.assumption.estimatedAmount;
    const calculationReady =
      missingEvidence.length === 0 &&
      (structured.assumption.status === "none" ||
        (structured.assumption.status === "possible" && amount != null));

    return {
      status: possibleRisk
        ? ("risk_detected" as const)
        : missingEvidence.length > 0
          ? ("needs_data" as const)
          : ("auto_complete" as const),
      label: possibleRisk
        ? "주의 권리 감지"
        : missingEvidence.length > 0
          ? "추가 자료 필요"
          : "자동 분석 완료",
      calculationReady,
      assumptionAmount: calculationReady ? Math.max(0, amount ?? 0) : null,
      confidence:
        calculationReady && !possibleRisk
          ? ("high" as const)
          : calculationReady
            ? ("medium" as const)
            : ("low" as const),
      exceptionReasons: [
        ...missingEvidence.map((item) => `자료 필요: ${item}`),
        ...(possibleRisk ? ["인수 가능성이 있는 권리가 감지되었습니다."] : []),
        ...(!calculationReady && missingEvidence.length === 0
          ? ["인수금액을 안전하게 산정할 근거가 부족합니다."]
          : []),
      ],
    };
  }

  private buildUserPrompt(auction: Auction, knowledgeBlock: string) {
    return `${knowledgeBlock}

[물건 식별정보]
- 사건번호: ${auction.auctionNo}
- 주소: ${auction.address}
- 유형: ${auction.propType} / ${auction.usage}
- 입찰일: ${auction.bidDate}

[권리·임차]
- 등기부: ${auction.buildingRegistry || "없음"}
- 임차인: ${auction.tenantInfo || "없음"}
- 임차인 현황: ${formatTenantStatusText(auction.tenantDetail) || "없음"}
- 특이사항: ${auction.specialNote || "없음"}
- 입찰정보: ${auction.bidInfo || "-"}
- 미납 관리비: ${auction.unpaidFeeAmount ? `${fmt(auction.unpaidFeeAmount)}원` : "미확인 또는 없음"}
- 미납 관리비 조사일: ${auction.unpaidFeeCheckedAt || "미확인"}
- 미납 관리비 조사내용: ${auction.unpaidFeeNote || "없음"}

위 정보와 [내부 경매지식]만 바탕으로 물건 공통 권리분석을 작성하세요.
채권금액·채권최고액·경매 청구금액은 그 자체로 낙찰자 인수금액이 아닙니다.
소멸 여부와 배당 관계를 확인하지 않고 인수금액으로 합산하지 마세요.`;
  }

  private rightsFingerprint(auction: Auction) {
    const rightsSource = {
      auctionNo: auction.auctionNo,
      buildingRegistry: auction.buildingRegistry,
      tenantInfo: auction.tenantInfo,
      tenantDetail: formatTenantStatusText(auction.tenantDetail),
      specialNote: auction.specialNote,
      bidInfo: auction.bidInfo,
      unpaidFeeAmount: auction.unpaidFeeAmount,
      unpaidFeeCheckedAt: auction.unpaidFeeCheckedAt,
      unpaidFeeNote: auction.unpaidFeeNote,
    };
    return createHash("sha256")
      .update(JSON.stringify(rightsSource))
      .digest("hex");
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
    const payload = JSON.parse(row.resultJson) as Awaited<
      ReturnType<OpenAiService["analyzeAuction"]>
    > & {
      autoRights?: ReturnType<AiAnalysisService["buildAutoRights"]>;
      _rightsFingerprint?: string;
    };
    const { _rightsFingerprint: _internalFingerprint, ...publicPayload } = payload;
    return {
      id: row.id,
      auctionId: row.auctionId,
      model: row.model,
      createdAt: row.createdAt,
      ...extra,
      ...publicPayload,
      autoRights: payload.autoRights ?? this.buildAutoRights(payload),
    };
  }

  async getLatest(auctionId: string) {
    const row = await this.analysisRepo.findOne({
      where: { auctionId },
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
    const isAdmin = role === UserRole.ADMIN;
    const fingerprint = this.rightsFingerprint(auction);

    // 사용자가 버튼을 눌렀을 때만 여기 진입한다. 권리 관련 원문과 RAG
    // 버전이 같으면 누가 생성했는지와 무관하게 공용 결과를 즉시 재사용한다.
    const existing = await this.analysisRepo.findOne({
      where: { auctionId },
      order: { createdAt: "DESC" },
    });
    if (existing && !refresh) {
      const payload = JSON.parse(existing.resultJson) as {
        _rightsFingerprint?: string;
      };
      if (payload._rightsFingerprint === fingerprint) {
        return this.parseResult(existing, { cached: true, stale: false });
      }
    }

    // 같은 물건을 여러 사용자가 동시에 누르면 첫 요청만 AI를 호출하고,
    // 나머지는 완료를 기다린 뒤 같은 공용 결과를 받는다.
    const inFlight = this.analysisInFlight.get(auctionId);
    if (inFlight) {
      await inFlight;
      const completed = await this.analysisRepo.findOne({
        where: { auctionId },
        order: { createdAt: "DESC" },
      });
      if (completed) {
        return this.parseResult(completed, { cached: true, stale: false });
      }
    }

    let releaseAnalysis!: () => void;
    const analysisGate = new Promise<void>((resolve) => {
      releaseAnalysis = resolve;
    });
    this.analysisInFlight.set(auctionId, analysisGate);

    try {
    const user = username
      ? await this.usersService.findByUsername(username)
      : null;

    if (!isAdmin) {
      const limit = user?.aiAnalysisLimit ?? 0;
      const used = user?.aiAnalysisUsed ?? 0;
      if (used >= limit) {
        throw new ForbiddenException(
          `AI 분석 가능 횟수(${limit}회)를 모두 사용했습니다. 관리자에게 문의해 주세요.`,
        );
      }
    }

    // 물건 상세 "AI에게 물어보기"는 권리분석 전용 AI로 운영한다(물건추천 지식은
    // 별도 파이프라인에서 다룰 예정 — 두 AI가 같은 컨텍스트를 함께 보지 않도록 분리).
    const knowledgeItems = await this.knowledgeService.searchForAuction(auction, 5, "권리분석");
    const knowledgeBlock = this.knowledgeService.formatForPrompt(knowledgeItems);
    const citations = knowledgeItems.map((k) =>
      k.category ? `[${k.category}] ${k.title}` : k.title,
    );

    const userPrompt = this.buildUserPrompt(auction, knowledgeBlock);

    const llm = await this.openAi.analyzeAuction(SYSTEM_PROMPT, userPrompt);

    if (!isAdmin && username) {
      await this.usersService.incrementAiAnalysisUsage(username);
    }

    const resultPayload = {
      ...llm,
      // 공용 권리분석 DB에는 회원별 대출·자금·투자적합도 내용을 저장하지 않는다.
      priceAnalysis: "",
      loanAnalysis: "",
      investmentFit: "",
      autoRights: this.buildAutoRights(llm),
      citations,
      knowledgeCount: knowledgeItems.length,
      _rightsFingerprint: fingerprint,
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
    } finally {
      releaseAnalysis();
      if (this.analysisInFlight.get(auctionId) === analysisGate) {
        this.analysisInFlight.delete(auctionId);
      }
    }
  }
}
