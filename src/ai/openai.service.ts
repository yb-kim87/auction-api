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
      await response.text().catch(() => "");
      throw new InternalServerErrorException(
        `경매코치 AI 분석 요청에 실패했습니다. (${response.status})`,
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
    };
  }
}
