import { BadRequestException, Controller, Get, Headers, Post, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { RealtorCollectService } from "./realtor-collect.service";

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
      sidoCode,
      gugunCode,
      dongCode,
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
    const buffer = await this.service.exportExcel({ sidoCode, gugunCode, dongCode, search });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="realtor-offices.xlsx"');
    res.send(buffer);
  }
}
