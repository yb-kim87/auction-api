import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";

export type AnalysisLlmResult = {
  summary: string;
  priceAnalysis: string;
  rightsAnalysis: string;
  loanAnalysis: string;
  investmentFit: string;
  checklist: string[];
  recommendation: string;
  risks: string[];
  structuredRights: {
    reviewStatus: "unknown" | "possible" | "none";
    baselineRight: {
      type: string;
      date: string;
      reason: string;
    };
    tenant: {
      priorityStatus: "unknown" | "possible" | "none";
      opposability: "unknown" | "possible" | "none";
      depositAmount: number | null;
    };
    assumption: {
      status: "unknown" | "possible" | "none";
      estimatedAmount: number | null;
      reason: string;
    };
    missingEvidence: string[];
    evidence: string[];
    knowledgeEvidence: Array<{
      title: string;
      appliedRule: string;
    }>;
  };
};

@Injectable()
export class OpenAiService {
  private get apiKey() {
    return process.env.OPENAI_API_KEY?.trim() ?? "";
  }

  private get model() {
    return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async structureCafePost(input: {
    sourceTitle: string;
    sourceBoard: string;
    rawContent: string;
  }): Promise<{
    skip: boolean;
    skipReason?: string;
    title: string;
    category: string;
    tags: string;
    content: string;
    note: string;
  }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. OPENAI_API_KEY를 확인해 주세요.",
      );
    }

    const systemPrompt = `당신은 경매 투자 플랫폼 "경매코치"의 내부 지식 편집자입니다.
네이버 카페 게시글을 경매 분석 AI(RAG)가 참고할 **내부 경매지식**으로 정리합니다.

규칙:
- 법률 자문이 아닌 "입찰 전 확인 포인트·내부 가이드" 톤으로 작성
- 잡담·인사·질문만 있고 실질 지식이 없으면 skip=true
- category는 반드시 하나: 권리분석 | 대출 | 가격분석 | 투자전략 | 기타
- tags는 쉼표 구분 (예: 대항력,임차,LTV)
- content는 체크리스트·원칙·주의사항 중심, 800자 이내
- 개인정보(이름, 연락처, 주민번호)는 제거

JSON 형식:
{
  "skip": false,
  "skipReason": "",
  "title": "지식 제목",
  "category": "권리분석",
  "tags": "대항력,임차",
  "content": "정리된 본문",
  "note": "편집 시 참고 메모"
}`;

    const userPrompt = `[원문 제목] ${input.sourceTitle}
[게시판] ${input.sourceBoard}

[원문]
${input.rawContent.slice(0, 6000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `경매코치 AI 정리 요청에 실패했습니다. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      skip: Boolean(parsed.skip),
      skipReason: String(parsed.skipReason ?? ""),
      title: String(parsed.title ?? input.sourceTitle),
      category: String(parsed.category ?? "기타"),
      tags: String(parsed.tags ?? ""),
      content: String(parsed.content ?? ""),
      note: String(parsed.note ?? ""),
    };
  }

  /**
   * 관리자가 카테고리+원본 메모를 입력하면, 지식 등록 폼(제목/태그/내용)
   * 형식에 맞게 AI가 다듬어 반환한다(저장은 하지 않음 — 관리자가 결과를
   * 확인·수정한 뒤 기존 저장 버튼으로 최종 승인).
   */
  async structureKnowledgeInput(input: {
    category: string;
    rawText: string;
  }): Promise<{ title: string; tags: string; content: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. OPENAI_API_KEY를 확인해 주세요.",
      );
    }

    const systemPrompt = `당신은 경매 투자 플랫폼 "경매코치"의 내부 지식 편집자입니다.
관리자가 입력한 메모를 경매 분석 AI(RAG)가 참고할 **내부 경매지식** 항목으로 다듬습니다.

규칙:
- 법률 자문이 아닌 "입찰 전 확인 포인트·내부 가이드" 톤으로 작성
- 원문의 의미를 바꾸지 말고, 체크리스트·원칙·주의사항 중심으로 정리
- tags는 쉼표 구분 핵심 키워드 3~6개 (예: 대항력,임차,LTV)
- content는 800자 이내, 마크다운 없이 일반 텍스트로 작성
- 개인정보(이름, 연락처, 주민번호)는 제거

JSON 형식으로만 응답:
{
  "title": "지식 제목",
  "tags": "대항력,임차",
  "content": "정리된 본문"
}`;

    const userPrompt = `[분류] ${input.category}

[원본 메모]
${input.rawText.slice(0, 6000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `경매코치 AI 정리 요청에 실패했습니다. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      title: String(parsed.title ?? ""),
      tags: String(parsed.tags ?? ""),
      content: String(parsed.content ?? input.rawText),
    };
  }

  /** 관리자가 입력한 전략 설명 초안을 사용자 노출용 문구로 다듬는다.
   * 물건추천 화면에 그대로 보여줄 문장이라 AI지식 정리(structureKnowledgeInput)와
   * 달리 존댓말·완결된 문장·과장 없는 톤을 강제한다. */
  async refineStrategyDescription(input: {
    label: string;
    rawText: string;
  }): Promise<{ description: string }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. OPENAI_API_KEY를 확인해 주세요.",
      );
    }

    const systemPrompt = `당신은 경매 투자 플랫폼 "경매코치"의 사용자 노출 문구 편집자입니다.
관리자가 입력한 초안을, 물건 상세페이지에 배지와 함께 보여줄 "전략 설명"
문구로 다듬습니다.

규칙:
- 사용자가 읽는 화면 문구이므로 정중하고 명확한 존댓말로 작성
- 원문의 의미·판단 근거를 바꾸지 말고 문장만 다듬기(과장, 확정적 수익 보장 표현 금지)
- 2~4문장, 200자 이내
- 마크다운 없이 일반 텍스트로 작성
- 개인정보(이름, 연락처, 주민번호)는 제거

JSON 형식으로만 응답:
{
  "description": "다듬어진 설명 문구"
}`;

    const userPrompt = `[전략 라벨] ${input.label}

[관리자가 입력한 원본 설명]
${input.rawText.slice(0, 2000)}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `경매코치 AI 정리 요청에 실패했습니다. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      description: String(parsed.description ?? input.rawText),
    };
  }

  async answerFreeform(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `경매코치 AI 응답 요청에 실패했습니다. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }
    return content;
  }

  async compareAuctions(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ summary: string; betterChoice: string; reasons: string[] }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new InternalServerErrorException(
        `경매코치 AI 비교 요청에 실패했습니다. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      summary: String(parsed.summary ?? ""),
      betterChoice: String(parsed.betterChoice ?? "상황에따라다름"),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((v) => String(v)) : [],
    };
  }

  async analyzeAuction(systemPrompt: string, userPrompt: string): Promise<AnalysisLlmResult> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        "경매코치 AI를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.",
      );
    }

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[AI rights analysis] OpenAI connection failed: ${reason}`);
      throw new ServiceUnavailableException(
        "AI 분석 서비스에 연결할 수 없습니다. API 서버의 외부 네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
      );
    }

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");
      console.error(
        `[AI rights analysis] OpenAI request failed: ${response.status} ${responseBody.slice(0, 500)}`,
      );
      if (response.status === 429) {
        throw new ServiceUnavailableException(
          "AI 분석 요청이 일시적으로 많거나 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
        );
      }
      throw new ServiceUnavailableException(
        `AI 분석 요청에 실패했습니다. 잠시 후 다시 시도해 주세요. (${response.status})`,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new InternalServerErrorException("경매코치 AI 응답이 비어 있습니다.");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content) as Record<string, unknown>;
    } catch {
      throw new InternalServerErrorException("경매코치 AI 응답 처리에 실패했습니다.");
    }

    return {
      summary: String(parsed.summary ?? ""),
      priceAnalysis: String(parsed.priceAnalysis ?? ""),
      rightsAnalysis: String(parsed.rightsAnalysis ?? ""),
      loanAnalysis: String(parsed.loanAnalysis ?? ""),
      investmentFit: String(parsed.investmentFit ?? ""),
      checklist: Array.isArray(parsed.checklist)
        ? parsed.checklist.map((v) => String(v))
        : [],
      recommendation: String(parsed.recommendation ?? "검토"),
      risks: Array.isArray(parsed.risks) ? parsed.risks.map((v) => String(v)) : [],
      structuredRights: (() => {
        const raw =
          parsed.structuredRights && typeof parsed.structuredRights === "object"
            ? (parsed.structuredRights as Record<string, unknown>)
            : {};
        const baseline =
          raw.baselineRight && typeof raw.baselineRight === "object"
            ? (raw.baselineRight as Record<string, unknown>)
            : {};
        const tenant =
          raw.tenant && typeof raw.tenant === "object"
            ? (raw.tenant as Record<string, unknown>)
            : {};
        const assumption =
          raw.assumption && typeof raw.assumption === "object"
            ? (raw.assumption as Record<string, unknown>)
            : {};
        const status = (value: unknown): "unknown" | "possible" | "none" =>
          value === "possible" || value === "none" ? value : "unknown";
        const nullableAmount = (value: unknown): number | null => {
          if (value === null || value === undefined || value === "") return null;
          const amount = Number(value);
          return Number.isFinite(amount) && amount >= 0 ? Math.round(amount) : null;
        };
        return {
          reviewStatus: status(raw.reviewStatus),
          baselineRight: {
            type: String(baseline.type ?? ""),
            date: String(baseline.date ?? ""),
            reason: String(baseline.reason ?? ""),
          },
          tenant: {
            priorityStatus: status(tenant.priorityStatus),
            opposability: status(tenant.opposability),
            depositAmount: nullableAmount(tenant.depositAmount),
          },
          assumption: {
            status: status(assumption.status),
            estimatedAmount: nullableAmount(assumption.estimatedAmount),
            reason: String(assumption.reason ?? ""),
          },
          missingEvidence: Array.isArray(raw.missingEvidence)
            ? raw.missingEvidence.map((value) => String(value))
            : [],
          evidence: Array.isArray(raw.evidence)
            ? raw.evidence.map((value) => String(value))
            : [],
          knowledgeEvidence: Array.isArray(raw.knowledgeEvidence)
            ? raw.knowledgeEvidence
                .filter((value) => value && typeof value === "object")
                .map((value) => {
                  const row = value as Record<string, unknown>;
                  return {
                    title: String(row.title ?? "").trim(),
                    appliedRule: String(row.appliedRule ?? "").trim(),
                  };
                })
                .filter((value) => value.title && value.appliedRule)
            : [],
        };
      })(),
    };
  }
}
