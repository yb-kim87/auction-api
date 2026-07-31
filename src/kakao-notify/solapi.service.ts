import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { createHmac, randomBytes } from "crypto";

export type SolapiSendResult = {
  ok: boolean;
  statusCode: number;
  responseBody: unknown;
  errorMessage?: string;
};

export type SolapiTemplateButton = {
  buttonType?: string;
  buttonName?: string;
  linkAnd?: string;
  linkIos?: string;
  linkPc?: string;
  linkMo?: string;
};

export type SolapiTemplate = {
  templateId: string;
  name: string;
  status: string;
  content: string;
  buttons: SolapiTemplateButton[];
  emphasizeTitle: string | null;
  emphasizeSubtitle: string | null;
  extra: string | null;
};

/**
 * 솔라피(SOLAPI) 카카오 알림톡 발송.
 * 인증은 HMAC-SHA256 서명(API Key + Secret Key) 방식이며 매 요청마다
 * date/salt를 새로 생성해 서명한다. 참고: https://developers.solapi.com
 */
@Injectable()
export class SolapiService {
  private get apiKey() {
    return process.env.SOLAPI_API_KEY?.trim() ?? "";
  }

  private get apiSecret() {
    return process.env.SOLAPI_API_SECRET?.trim() ?? "";
  }

  private get senderPhone() {
    return process.env.SOLAPI_SENDER?.trim() ?? "";
  }

  private get pfId() {
    return process.env.SOLAPI_PFID?.trim() ?? "";
  }

  private get defaultTemplateCode() {
    return process.env.SOLAPI_TEMPLATE_CODE?.trim() ?? "";
  }

  /** SMS 발송에 필요한 최소 설정(발신번호까지). 카카오 알림톡은 pfId도 추가로 필요하다. */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiSecret && this.senderPhone);
  }

  private isKakaoConfigured(): boolean {
    return this.isConfigured() && Boolean(this.pfId);
  }

  private buildAuthHeader(): string {
    const date = new Date().toISOString();
    const salt = randomBytes(16).toString("hex");
    const signature = createHmac("sha256", this.apiSecret)
      .update(date + salt)
      .digest("hex");
    return `HMAC-SHA256 apiKey=${this.apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
  }

  /**
   * 알림톡 발송. templateCode를 안 넘기면 SOLAPI_TEMPLATE_CODE 기본값을 사용한다.
   * variables는 템플릿의 #{변수명} 치환값.
   */
  async sendAlimtalk(input: {
    toPhone: string;
    variables: Record<string, string>;
    templateCode?: string;
  }): Promise<SolapiSendResult> {
    if (!this.isKakaoConfigured()) {
      throw new ServiceUnavailableException(
        "솔라피 연동이 설정되지 않았습니다. SOLAPI_API_KEY/SOLAPI_API_SECRET/SOLAPI_SENDER/SOLAPI_PFID를 확인해 주세요.",
      );
    }

    const templateCode = input.templateCode?.trim() || this.defaultTemplateCode;
    if (!templateCode) {
      throw new ServiceUnavailableException(
        "알림톡 템플릿 코드가 설정되지 않았습니다. SOLAPI_TEMPLATE_CODE를 확인해 주세요.",
      );
    }

    // 솔라피 v4 발송 API는 변수 키를 "#{변수명}" 형태(중괄호 포함)로 요구한다.
    const wrappedVariables = Object.fromEntries(
      Object.entries(input.variables).map(([key, value]) => [
        key.startsWith("#{") ? key : `#{${key}}`,
        value,
      ]),
    );

    const requestBody = {
      message: {
        to: input.toPhone,
        from: this.senderPhone,
        kakaoOptions: {
          pfId: this.pfId,
          templateId: templateCode,
          variables: wrappedVariables,
        },
      },
    };

    try {
      const res = await fetch("https://api.solapi.com/messages/v4/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.buildAuthHeader(),
        },
        body: JSON.stringify(requestBody),
      });

      const responseBody = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          typeof (responseBody as { errorMessage?: string })?.errorMessage ===
          "string"
            ? (responseBody as { errorMessage?: string }).errorMessage
            : `솔라피 발송 실패 (HTTP ${res.status})`;
        return {
          ok: false,
          statusCode: res.status,
          responseBody,
          errorMessage: message,
        };
      }

      return { ok: true, statusCode: res.status, responseBody };
    } catch (err) {
      return {
        ok: false,
        statusCode: 0,
        responseBody: null,
        errorMessage:
          err instanceof Error ? err.message : "솔라피 요청 중 알 수 없는 오류",
      };
    }
  }

  /**
   * 문자(SMS/LMS) 발송. 카카오 알림톡과 달리 템플릿 승인이 필요 없어
   * 자유 텍스트를 그대로 보낸다. 90바이트(한글 45자 안팎)를 넘으면
   * 솔라피 규격상 LMS로 자동 전환되며, 이때 subject(제목)가 없으면
   * 기본 제목을 채워 보낸다(subject 없는 LMS는 발송 실패하기 때문).
   */
  async sendSms(input: {
    toPhone: string;
    text: string;
    subject?: string;
  }): Promise<SolapiSendResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "솔라피 연동이 설정되지 않았습니다. SOLAPI_API_KEY/SOLAPI_API_SECRET/SOLAPI_SENDER를 확인해 주세요.",
      );
    }
    const text = input.text.trim();
    if (!text) {
      throw new ServiceUnavailableException("문자 내용이 비어있습니다.");
    }

    const byteLength = Buffer.byteLength(text, "utf-8");
    const message: Record<string, unknown> = {
      to: input.toPhone,
      from: this.senderPhone,
      text,
    };
    if (byteLength > 90) {
      message.type = "LMS";
      message.subject = input.subject?.trim() || "안내";
    }

    try {
      const res = await fetch("https://api.solapi.com/messages/v4/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.buildAuthHeader(),
        },
        body: JSON.stringify({ message }),
      });

      const responseBody = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errMessage =
          typeof (responseBody as { errorMessage?: string })?.errorMessage ===
          "string"
            ? (responseBody as { errorMessage?: string }).errorMessage
            : `솔라피 발송 실패 (HTTP ${res.status})`;
        return {
          ok: false,
          statusCode: res.status,
          responseBody,
          errorMessage: errMessage,
        };
      }

      return { ok: true, statusCode: res.status, responseBody };
    } catch (err) {
      return {
        ok: false,
        statusCode: 0,
        responseBody: null,
        errorMessage:
          err instanceof Error ? err.message : "솔라피 요청 중 알 수 없는 오류",
      };
    }
  }

  /**
   * 이 계정에 등록된(PFID에 연결된) 카카오 알림톡 템플릿 목록을 조회한다.
   * 관리자 화면에서 템플릿 코드를 직접 입력하지 않고 드롭다운으로
   * 선택할 수 있도록 하기 위함 — Make의 "알림톡 템플릿" 드롭다운과 동일한 역할.
   */
  async listTemplates(): Promise<SolapiTemplate[]> {
    if (!this.apiKey || !this.apiSecret) {
      throw new ServiceUnavailableException(
        "솔라피 API 키가 설정되지 않았습니다. SOLAPI_API_KEY/SOLAPI_API_SECRET을 확인해 주세요.",
      );
    }

    const params = new URLSearchParams({ limit: "500" });
    if (this.pfId) params.set("channelId", this.pfId);

    const res = await fetch(`https://api.solapi.com/kakao/v2/templates?${params.toString()}`, {
      headers: { Authorization: this.buildAuthHeader() },
    });
    const body = (await res.json().catch(() => ({}))) as {
      templateList?: Array<{
        templateId?: string;
        name?: string;
        status?: string;
        content?: string;
        buttons?: SolapiTemplateButton[];
        emphasizeTitle?: string | null;
        emphasizeSubtitle?: string | null;
        extra?: string | null;
      }>;
      errorMessage?: string;
    };

    if (!res.ok) {
      throw new Error(
        body.errorMessage ?? `솔라피 템플릿 목록 조회 실패 (HTTP ${res.status})`,
      );
    }

    return (body.templateList ?? [])
      .filter((t) => t.status === "APPROVED")
      .map((t) => ({
        templateId: t.templateId ?? "",
        name: t.name ?? "",
        status: t.status ?? "",
        content: t.content ?? "",
        buttons: t.buttons ?? [],
        emphasizeTitle: t.emphasizeTitle ?? null,
        emphasizeSubtitle: t.emphasizeSubtitle ?? null,
        extra: t.extra ?? null,
      }));
  }
}
