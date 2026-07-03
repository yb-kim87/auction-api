import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Headers,
  BadRequestException,
} from "@nestjs/common";
import { LoanPolicyService } from "./loan-policy.service";
import { getAuthContext, requireAdmin, requireAuth } from "../common/auth-context";

@Controller("loan-policies")
export class LoanPolicyController {
  constructor(private readonly loanPolicyService: LoanPolicyService) {}

  @Get()
  async findAll(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    return this.loanPolicyService.findAll();
  }

  @Patch(":id")
  async updateRatio(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { loanRatio?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    const ratio = Number(body.loanRatio);
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) {
      throw new BadRequestException("대출 비율은 0~1 사이 값으로 입력해 주세요.");
    }
    return this.loanPolicyService.updateRatio(id, ratio);
  }
}
