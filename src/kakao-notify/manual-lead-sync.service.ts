import { Injectable, Logger } from "@nestjs/common";
import { GoogleSheetsService } from "./google-sheets.service";
import { KakaoNotifyService } from "./kakao-notify.service";
import { KakaoSyncStateService } from "./kakao-sync-state.service";

/** 고정 컬럼 헤더명(여러 표기를 허용) → 내부 필드 매핑. 이 외의 모든
 *  헤더는 설문 질문으로 간주해 surveyAnswers에 그대로 담는다. */
const NAME_HEADERS = ["이름", "성명", "name"];
const PHONE_HEADERS = ["연락처(휴대폰번호)", "연락처", "휴대폰번호", "전화번호", "phone"];
const RESPONDED_AT_HEADERS = ["응답일시", "가입일시", "등록일시", "일시"];
const SOURCE_MEDIUM_HEADERS = ["저장매체", "유입경로", "폼종류"];
/** 값이 채워져 있으면(무엇이든) 이미 수강 중/수강 이력이 있는 회원으로 보고
 *  일괄발송(알림톡) 대상에서 자동 제외한다. 리드 자체는 그대로 목록에 저장된다. */
const ENROLLED_HEADERS = ["수강생여부", "수강여부", "수강생"];

function matchesHeader(header: string, candidates: string[]): boolean {
  const normalized = header.trim();
  return candidates.some((c) => normalized === c || normalized.startsWith(c));
}

/**
 * 관리자가 직접(또는 네이버폼 등 외부 설문 서비스가) 채워 넣는 수동 리드
 * 구글시트를 소스로 읽는다. 인스타/아임웹처럼 스케줄러로 자동 동기화하지
 * 않고, 관리자가 "적용" 버튼을 누른 시점에만 1회 실행된다.
 *
 * 시트 1행을 헤더로 읽어 "이름/연락처/응답일시/저장매체" 계열 컬럼만 위치
 * 기반이 아닌 헤더명으로 찾아 고정 필드에 매핑하고, 그 외 모든 열(나이대,
 * 직업, 경매 경험, 유입경로 등 설문 질문)은 헤더명을 키로 하는 JSON
 * 객체(surveyAnswers)로 통째로 저장한다. 이렇게 하면 설문 질문 구성이
 * 바뀌어도(질문 추가/삭제/순서변경) 코드 수정 없이 그대로 반영된다.
 * "no" 같은 일련번호 컬럼은 매칭되는 고정 필드가 없으므로 자동으로
 * surveyAnswers에 포함되지만 실사용에는 영향 없다.
 *
 * 가입시각 워터마크 방식 대신 매번 시트 전체를 읽어 (source, phone) 기준
 * 없는 행만 새로 저장한다(ingestLead의 중복 처리 로직 재사용). 자동발송은
 * 하지 않고 status="pending"으로만 저장해, 관리자가 기존 목록 화면에서
 * 선택 발송한다.
 */
@Injectable()
export class ManualLeadSyncService {
  private readonly logger = new Logger(ManualLeadSyncService.name);

  constructor(
    private readonly sheets: GoogleSheetsService,
    private readonly kakaoNotifyService: KakaoNotifyService,
    private readonly syncStateService: KakaoSyncStateService,
  ) {}

  async getSheetConfig(): Promise<{ spreadsheetId: string; sheetRange: string }> {
    const config = await this.syncStateService.getConfig<{
      spreadsheetId?: string;
      sheetRange?: string;
    }>("manual_sheet");
    return {
      spreadsheetId: config.spreadsheetId?.trim() || "",
      // 1행(헤더)부터 읽는다 — 인스타/아임웹 시트와 달리 헤더를 직접 파싱해야 하기 때문.
      sheetRange: config.sheetRange?.trim() || "시트1!A1:Z",
    };
  }

  async setSheetConfig(spreadsheetId: string, sheetRange: string) {
    await this.syncStateService.setConfig("manual_sheet", {
      spreadsheetId: spreadsheetId.trim(),
      sheetRange: sheetRange.trim(),
    });
  }

  async isConfigured(): Promise<boolean> {
    const { spreadsheetId } = await this.getSheetConfig();
    return Boolean(spreadsheetId) && this.sheets.isConfigured();
  }

  /** "적용" 버튼을 눌렀을 때 1회 실행. 시트 전체(헤더 포함)를 읽어 신규 행만 리드로 저장한다. */
  async applyNow(): Promise<{
    processed: number;
    created: number;
    duplicate: number;
    invalidPhone: number;
  }> {
    if (!(await this.isConfigured())) {
      throw new Error(
        "수동 리드(구글시트) 연동이 설정되지 않았습니다. 구글시트 ID를 입력하고 구글 서비스 계정 환경변수를 확인해 주세요.",
      );
    }

    const { spreadsheetId, sheetRange } = await this.getSheetConfig();
    const rows = await this.sheets.readRange(spreadsheetId, sheetRange);
    if (rows.length === 0) return { processed: 0, created: 0, duplicate: 0, invalidPhone: 0 };

    const [headerRow, ...dataRows] = rows;
    const columns = headerRow.map((h) => (h ?? "").trim());

    const nameIdx = columns.findIndex((h) => matchesHeader(h, NAME_HEADERS));
    const phoneIdx = columns.findIndex((h) => matchesHeader(h, PHONE_HEADERS));
    const respondedAtIdx = columns.findIndex((h) => matchesHeader(h, RESPONDED_AT_HEADERS));
    const sourceMediumIdx = columns.findIndex((h) => matchesHeader(h, SOURCE_MEDIUM_HEADERS));
    const enrolledIdx = columns.findIndex((h) => matchesHeader(h, ENROLLED_HEADERS));

    if (phoneIdx === -1) {
      throw new Error(
        `시트 헤더에서 연락처(전화번호) 컬럼을 찾지 못했습니다. 헤더 행에 "${PHONE_HEADERS.join(", ")}" 중 하나가 있어야 합니다.`,
      );
    }

    let processed = 0;
    let created = 0;
    let duplicate = 0;
    let invalidPhone = 0;
    const invalidRows: string[] = [];

    for (const row of dataRows) {
      const rawPhone = row[phoneIdx];
      if (!rawPhone?.trim()) continue;
      const phone = fixLeadingZeroPhone(rawPhone);

      processed += 1;
      const name = nameIdx !== -1 ? row[nameIdx] ?? "" : "";
      const respondedAtRaw = respondedAtIdx !== -1 ? row[respondedAtIdx] : undefined;
      const sourceMedium = sourceMediumIdx !== -1 ? row[sourceMediumIdx] ?? "" : "";
      const joinedAt = respondedAtRaw ? parseManualSheetDate(respondedAtRaw) : null;
      const isEnrolled = enrolledIdx !== -1 && Boolean(row[enrolledIdx]?.trim());

      const surveyAnswers: Record<string, string> = {};
      columns.forEach((header, idx) => {
        if (!header) return;
        if (
          idx === nameIdx ||
          idx === phoneIdx ||
          idx === respondedAtIdx ||
          idx === sourceMediumIdx ||
          idx === enrolledIdx
        )
          return;
        const value = row[idx];
        if (value?.trim()) surveyAnswers[header] = value.trim();
      });

      const result = await this.kakaoNotifyService.ingestLead({
        source: "manual_sheet",
        sourceRefId: phone.trim(),
        name,
        rawPhone: phone,
        channel: sourceMedium,
        surveyAnswers,
        excludedFromBulk: isEnrolled,
        joinedAt,
        rawPayload: row,
      });
      if (result.outcome === "created" || result.outcome === "resubmitted") created += 1;
      else if (result.outcome === "duplicate") duplicate += 1;
      else if (result.outcome === "invalid_phone") {
        invalidPhone += 1;
        invalidRows.push(`${name || "(이름없음)"}(${rawPhone})`);
      }
    }

    await this.syncStateService.recordRunResult("manual_sheet", { status: "ok" });

    this.logger.log(
      `수동 리드 시트 적용 완료: ${processed}건 확인, ${created}건 신규, ` +
        `${duplicate}건 중복, ${invalidPhone}건 전화번호 형식오류` +
        (invalidRows.length > 0 ? ` [${invalidRows.join(", ")}]` : ""),
    );
    return { processed, created, duplicate, invalidPhone };
  }
}

/** 구글시트가 연락처를 숫자로 인식해 앞자리 0이 잘린 경우("1012345678" 등
 *  10자리, 01[0-9]로 시작해야 할 자리가 1[0-9]로 시작)를 보정한다. 이미
 *  0으로 시작하거나 형식이 다르면 원본 그대로 반환(normalizePhone이
 *  최종 검증). */
function fixLeadingZeroPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^1[0-9]\d{8}$/.test(digits)) return `0${digits}`;
  return raw;
}

/** 응답일시 컬럼 형식 파싱. "2025-10-09 14:46" 같은 공백구분 형식은 KST로
 *  간주하고, 이미 타임존 오프셋/Z가 포함된 ISO 형식이면 그대로 파싱한다. */
export function parseManualSheetDate(raw: string): Date | null {
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
