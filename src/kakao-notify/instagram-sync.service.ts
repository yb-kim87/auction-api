import { Injectable, Logger } from "@nestjs/common";
import { GoogleSheetsService } from "./google-sheets.service";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";
import { KakaoSyncRunnerService } from "./kakao-sync-runner.service";

/**
 * 인스타그램 리드 광고(Lead Ads) 원본 시트를 소스로 읽는다. 이 시트는
 * 이미 인스타 인스턴트 전용이라 별도 "구분" 컬럼은 없다. 컬럼 순서(A~S):
 * id, created_time, ad_id, ad_name, adset_id, adset_name, campaign_id,
 * campaign_name, form_id, form_name, is_organic, platform, 이름, 전화번호,
 * 이메일, lead_status, 알림톡 여부, 시트 전달, 메모. A열의 id(리드 광고
 * 고유 ID)를 sourceRefId로 사용한다.
 */
@Injectable()
export class InstagramSyncService {
  private readonly logger = new Logger(InstagramSyncService.name);

  constructor(
    private readonly sheets: GoogleSheetsService,
    private readonly kakaoNotifyService: KakaoNotifyService,
    private readonly syncStateService: KakaoSyncStateService,
    private readonly runner: KakaoSyncRunnerService,
  ) {}

  async getSheetConfig(): Promise<{ spreadsheetId: string; sheetRange: string }> {
    const config = await this.syncStateService.getConfig<{
      spreadsheetId?: string;
      sheetRange?: string;
    }>("instagram");
    return {
      spreadsheetId: config.spreadsheetId?.trim() || process.env.INSTAGRAM_SHEET_ID?.trim() || "",
      sheetRange:
        config.sheetRange?.trim() || process.env.INSTAGRAM_SHEET_RANGE?.trim() || "시트1!A2:O",
    };
  }

  async setSheetConfig(spreadsheetId: string, sheetRange: string) {
    await this.syncStateService.setConfig("instagram", {
      spreadsheetId: spreadsheetId.trim(),
      sheetRange: sheetRange.trim(),
    });
  }

  async isConfigured(): Promise<boolean> {
    const { spreadsheetId } = await this.getSheetConfig();
    return Boolean(spreadsheetId) && this.sheets.isConfigured();
  }

  async syncNewRows(): Promise<{ processed: number; created: number }> {
    if (!(await this.isConfigured())) {
      throw new Error(
        "인스타(구글시트) 연동이 설정되지 않았습니다. 관리자 화면에서 구글시트 ID를 입력하고 구글 서비스 계정 환경변수를 확인해 주세요.",
      );
    }

    const { spreadsheetId, sheetRange } = await this.getSheetConfig();
    const state = await this.syncStateService.getOrCreate("instagram");
    this.runner.start("instagram");

    let processed = 0;
    let created = 0;
    let latestJoinedAt: Date | null = state.lastSyncedAt;
    let cancelled = false;

    try {
      const rows = await this.sheets.readRange(spreadsheetId, sheetRange);

      for (const row of rows) {
        if (this.runner.isCancelRequested("instagram")) {
          cancelled = true;
          break;
        }

        const [
          id,
          createdTimeRaw,
          ,
          adName,
          ,
          ,
          ,
          ,
          ,
          ,
          ,
          ,
          name,
          phone,
          email,
        ] = row;
        if (!phone?.trim()) continue;

        const joinedAt = createdTimeRaw ? parseSheetDate(createdTimeRaw) : null;
        if (state.lastSyncedAt && joinedAt && joinedAt.getTime() <= state.lastSyncedAt.getTime()) {
          this.runner.progress("instagram");
          continue;
        }

        processed += 1;
        const sourceRefId = id?.trim() || `${createdTimeRaw ?? ""}|${phone}`;

        const result = await this.kakaoNotifyService.ingestAndDispatch({
          source: "instagram",
          sourceRefId,
          name: name ?? "",
          rawPhone: phone,
          email: email ?? "",
          adName: adName ?? "",
          joinedAt,
          rawPayload: row,
        });
        if (result.outcome === "created" || result.outcome === "resubmitted") created += 1;

        if (joinedAt && (!latestJoinedAt || joinedAt.getTime() > latestJoinedAt.getTime())) {
          latestJoinedAt = joinedAt;
        }
        this.runner.progress("instagram");
      }
    } finally {
      this.runner.finish("instagram");
    }

    await this.syncStateService.recordRunResult("instagram", {
      status: cancelled ? "error" : "ok",
      errorMessage: cancelled ? "관리자에 의해 중단됨" : null,
      lastSyncedAt: latestJoinedAt,
    });

    this.logger.log(`인스타 동기화 완료: ${processed}건 확인, ${created}건 신규`);
    return { processed, created };
  }

  /**
   * 이미 Make로 알림톡을 발송해온 기존 인스타 인스턴트 리드 전체를 발송
   * 없이 리드로만 채워넣고 상태를 sent로 표시한다(1회성 백필). 가입일
   * 오름차순으로 저장해 수집시각도 가입일 순서와 일치하게 한다.
   */
  async backfillExistingRows(): Promise<{ processed: number; created: number }> {
    if (!(await this.isConfigured())) {
      throw new Error(
        "인스타(구글시트) 연동이 설정되지 않았습니다. 관리자 화면에서 구글시트 ID를 입력하고 구글 서비스 계정 환경변수를 확인해 주세요.",
      );
    }

    const { spreadsheetId, sheetRange } = await this.getSheetConfig();
    const rows = await this.sheets.readRange(spreadsheetId, sheetRange);

    const parsed = rows
      .map((row) => {
        const [id, createdTimeRaw, , adName, , , , , , , , , name, phone, email] = row;
        return {
          id,
          adName,
          name,
          phone,
          email,
          joinedAt: createdTimeRaw ? parseSheetDate(createdTimeRaw) : null,
          createdTimeRaw,
          row,
        };
      })
      .filter((r) => r.phone?.trim())
      .sort((a, b) => (a.joinedAt?.getTime() ?? 0) - (b.joinedAt?.getTime() ?? 0));

    let processed = 0;
    let created = 0;
    let latestJoinedAt: Date | null = null;

    for (const r of parsed) {
      processed += 1;
      const sourceRefId = r.id?.trim() || `${r.createdTimeRaw ?? ""}|${r.phone}`;

      const result = await this.kakaoNotifyService.backfillLeadAsSent({
        source: "instagram",
        sourceRefId,
        name: r.name ?? "",
        rawPhone: r.phone,
        email: r.email ?? "",
        adName: r.adName ?? "",
        joinedAt: r.joinedAt,
        rawPayload: r.row,
      });
      if (result.outcome === "created" || result.outcome === "resubmitted") created += 1;

      if (r.joinedAt && (!latestJoinedAt || r.joinedAt.getTime() > latestJoinedAt.getTime())) {
        latestJoinedAt = r.joinedAt;
      }
    }

    await this.syncStateService.recordRunResult("instagram", {
      status: "ok",
      lastSyncedAt: latestJoinedAt,
    });

    this.logger.log(`인스타 백필 완료: ${processed}건 확인, ${created}건 신규 저장`);
    return { processed, created };
  }
}

/**
 * created_time 컬럼 형식 파싱. 이미 타임존 오프셋이 포함된 ISO 형식
 * ("2026-07-07T22:13:58-05:00")이면 그대로 파싱하고, 공백 구분 형식
 * ("YYYY-MM-DD HH:mm:ss", Make formatDate 결과)이면 KST로 간주한다.
 */
export function parseSheetDate(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/[+-]\d{2}:\d{2}$|Z$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const isoLike = trimmed.replace(" ", "T") + "+09:00";
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
