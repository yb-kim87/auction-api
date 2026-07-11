import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import * as jwt from "jsonwebtoken";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

/**
 * 구글 서비스 계정으로 Sheets API v4를 읽기 전용 호출한다.
 * GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY로
 * JWT를 서명해 access_token을 발급받는 표준 2-legged OAuth 흐름이며,
 * 대상 스프레드시트는 이 서비스 계정 이메일에 "뷰어"로 공유돼 있어야 한다.
 */
@Injectable()
export class GoogleSheetsService {
  private get serviceAccountEmail() {
    return process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim() ?? "";
  }

  private get privateKey() {
    let raw = (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY ?? "").trim();
    // 값 앞뒤에 큰따옴표가 그대로 포함된 채 등록된 경우(예: 배포 플랫폼 환경변수
    // UI에 .env 원문을 그대로 복사) 제거한다.
    if (raw.startsWith('"') && raw.endsWith('"')) {
      raw = raw.slice(1, -1);
    }
    // .env에 개행이 \n 문자열로 들어오는 경우가 많아 실제 개행으로 복원
    return raw.replace(/\\n/g, "\n");
  }

  isConfigured(): boolean {
    return Boolean(this.serviceAccountEmail && this.privateKey);
  }

  private async fetchAccessToken(): Promise<string> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        "구글 서비스 계정이 설정되지 않았습니다. GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY를 확인해 주세요.",
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const assertion = jwt.sign(
      {
        iss: this.serviceAccountEmail,
        scope: SHEETS_SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600,
      },
      this.privateKey,
      { algorithm: "RS256" },
    );

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      error?: string;
    };
    if (!res.ok || !body.access_token) {
      throw new Error(`구글 인증 실패: ${body.error ?? `HTTP ${res.status}`}`);
    }
    return body.access_token;
  }

  /**
   * 시트 범위를 2차원 배열(행 단위)로 읽는다. 첫 행은 헤더로 가정하지 않고
   * 그대로 반환하므로 호출부에서 헤더 유무를 처리한다.
   */
  async readRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const accessToken = await this.fetchAccessToken();
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json().catch(() => ({}))) as {
      values?: string[][];
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        `구글시트 조회 실패 (HTTP ${res.status}): ${body.error?.message ?? "알 수 없는 오류"}`,
      );
    }
    return body.values ?? [];
  }
}
