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
  async updatePolicy(
    @Headers() headers: Record<string, string>,
    @Param("id") id: string,
    @Body() body: { loanRatio?: number; appraisalRatio?: number; loanUnavailable?: boolean },
  ) {
    requireAdmin(getAuthContext(headers));
    const loanUnavailable = Boolean(body.loanUnavailable);
    if (loanUnavailable) {
      return this.loanPolicyService.updatePolicy(id, {
        loanRatio: 0,
        appraisalRatio: 0,
        loanUnavailable: true,
      });
    }
    const loanRatio = Number(body.loanRatio);
    const appraisalRatio = Number(body.appraisalRatio);
    if (!Number.isFinite(loanRatio) || loanRatio <= 0 || loanRatio > 1) {
      throw new BadRequestException("낙찰가 대출 비율은 0~1 사이 값으로 입력해 주세요.");
    }
    if (!Number.isFinite(appraisalRatio) || appraisalRatio <= 0 || appraisalRatio > 1) {
      throw new BadRequestException("감정가 대출 비율은 0~1 사이 값으로 입력해 주세요.");
    }
    return this.loanPolicyService.updatePolicy(id, {
      loanRatio,
      appraisalRatio,
      loanUnavailable: false,
    });
  }

  @Get("income-multiplier")
  async getIncomeMultiplier(@Headers() headers: Record<string, string>) {
    requireAuth(getAuthContext(headers));
    const value = await this.loanPolicyService.getIncomeLoanMultiplier();
    return { value };
  }

  @Patch("income-multiplier")
  async setIncomeMultiplier(
    @Headers() headers: Record<string, string>,
    @Body() body: { value?: number },
  ) {
    requireAdmin(getAuthContext(headers));
    const value = await this.loanPolicyService.setIncomeLoanMultiplier(Number(body.value));
    return { value };
  }
}
