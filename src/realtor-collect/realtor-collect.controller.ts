import { BadRequestException, Controller, Get, Headers, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { RealtorCollectService } from "./realtor-collect.service";

/** "1,2,3" 형태의 콤마 구분 코드 목록을 배열로 — 여러 지역 동시 필터(사용자 요청, 2026-09-27).
 * 빈 문자열/미지정이면 undefined(필터 없음, 전체). */
function splitCodes(v?: string): string[] | undefined {
  const codes = v?.split(",").map((s) => s.trim()).filter(Boolean);
  return codes && codes.length ? codes : undefined;
}

/** 관리자 페이지 "부동산수집" 탭 — 한방(karhanbang.com) 중개업소
 * 수집/조회/엑셀 내보내기(사용자 요청, 2026-08-10). 전부 관리자 전용. */
@Controller("realtor-collect")
export class RealtorCollectController {
  constructor(private readonly service: RealtorCollectService) {}

  @Get("sido")
  listSido(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.listSido();
  }

  // "수집된 중개업소 보기" 필터용 — DB에 이미 있는 지역만 반환(karhanbang.com 호출 없음).
  @Get("regions")
  getAvailableRegions(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getAvailableRegions();
  }

  @Get("sub-options")
  async getSubOptions(
    @Headers() headers: Record<string, string>,
    @Query("flag") flag: string,
    @Query("sidoCode") sidoCode: string,
    @Query("gugunCode") gugunCode?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (flag !== "S" && flag !== "G") throw new BadRequestException("flag는 S 또는 G여야 합니다.");
    if (!sidoCode?.trim()) throw new BadRequestException("sidoCode가 필요합니다.");
    return this.service.fetchSubOptions(flag, sidoCode, gugunCode);
  }

  @Get("status")
  getStatus(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.getStatus();
  }

  @Post("stop")
  stop(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.stop();
  }

  @Post("confirm")
  confirm(@Headers() headers: Record<string, string>) {
    requireAdmin(getAuthContext(headers));
    return this.service.confirm();
  }

  @Post("start")
  start(
    @Headers() headers: Record<string, string>,
    @Query("sidoCode") sidoCode: string,
    @Query("gugunCode") gugunCode: string,
    @Query("dongCode") dongCode: string,
    @Query("sidoName") sidoName: string,
    @Query("gugunName") gugunName: string,
    @Query("dongName") dongName: string,
  ) {
    requireAdmin(getAuthContext(headers));
    if (!sidoCode?.trim()) throw new BadRequestException("sidoCode가 필요합니다.");
    return this.service.start({
      sidoCode,
      gugunCode: gugunCode ?? "",
      dongCode: dongCode ?? "",
      sidoName: sidoName ?? "",
      gugunName: gugunName ?? "",
      dongName: dongName ?? "",
    });
  }

  @Get()
  list(
    @Headers() headers: Record<string, string>,
    @Query("sidoCode") sidoCode?: string,
    @Query("gugunCode") gugunCode?: string,
    @Query("dongCode") dongCode?: string,
    @Query("search") search?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    return this.service.list({
      sidoCodes: splitCodes(sidoCode),
      gugunCodes: splitCodes(gugunCode),
      dongCodes: splitCodes(dongCode),
      search,
      page: page ? Number(page) || 1 : undefined,
      pageSize: pageSize ? Number(pageSize) || 50 : undefined,
    });
  }

  @Get("export")
  async exportExcel(
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
    @Query("sidoCode") sidoCode?: string,
    @Query("gugunCode") gugunCode?: string,
    @Query("dongCode") dongCode?: string,
    @Query("search") search?: string,
  ) {
    requireAdmin(getAuthContext(headers));
    const buffer = await this.service.exportExcel({
      sidoCodes: splitCodes(sidoCode),
      gugunCodes: splitCodes(gugunCode),
      dongCodes: splitCodes(dongCode),
      search,
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="realtor-offices.xlsx"');
    res.send(buffer);
  }
}
