import { Controller, Get, Headers, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { getAuthContext, requireAdmin } from "../common/auth-context";
import { ContractFields, ContractService } from "./contract.service";

/** 관리자 페이지 "계약서 생성" 탭 — 경매 컨설팅 계약서(HWP 샘플) 를
 * 반복 입력 항목만 채워서 PDF로 내려주는 기능(사용자 요청, 2026-10-18). */
@Controller("contract")
export class ContractController {
  constructor(private readonly service: ContractService) {}

  @Get("consulting-pdf")
  async downloadConsultingPdf(
    @Headers() headers: Record<string, string>,
    @Res() res: Response,
    @Query("clientName") clientName?: string,
    @Query("clientBirth") clientBirth?: string,
    @Query("clientAddress") clientAddress?: string,
    @Query("clientPhone") clientPhone?: string,
    @Query("contractDate") contractDate?: string,
    @Query("retainerFee") retainerFee?: string,
    @Query("feeRate") feeRate?: string,
    @Query("companyName") companyName?: string,
    @Query("companyCeo") companyCeo?: string,
    @Query("companyAddress") companyAddress?: string,
    @Query("companyPhone") companyPhone?: string,
    @Query("bankName") bankName?: string,
    @Query("bankAccount") bankAccount?: string,
    @Query("bankHolder") bankHolder?: string,
  ) {
    requireAdmin(getAuthContext(headers));

    const fields: ContractFields = {
      clientName: clientName?.trim() || "",
      clientBirth: clientBirth?.trim() || "",
      clientAddress: clientAddress?.trim() || "",
      clientPhone: clientPhone?.trim() || "",
      contractDate: contractDate?.trim() || "2026년 06월 17일",
      retainerFee: retainerFee?.trim() || "2,000,000",
      feeRate: feeRate?.trim() || "2",
      companyName: companyName?.trim() || "코치픽",
      companyCeo: companyCeo?.trim() || "",
      companyAddress: companyAddress?.trim() || "",
      companyPhone: companyPhone?.trim() || "",
      bankName: bankName?.trim() || "신한은행",
      bankAccount: bankAccount?.trim() || "110-294-645628",
      bankHolder: bankHolder?.trim() || "김영배",
    };

    const pdf = await this.service.generatePdf(fields);
    const fileName = encodeURIComponent(`경매컨설팅계약서_${fields.clientName || "샘플"}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${fileName}`);
    res.send(pdf);
  }
}
