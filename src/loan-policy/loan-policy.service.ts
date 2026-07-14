import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LoanPolicy } from "./loan-policy.entity";
import { LoanSettings } from "./loan-settings.entity";

/** 대출 사실상 무제한(감정가 비율만 적용되는 정책에서 낙찰가 쪽이 절대 더 낮게
 *  걸리지 않도록 하는 값). */
const UNLIMITED_RATIO = 10;

const INCOME_MULTIPLIER_KEY = "incomeLoanMultiplier";
const DEFAULT_INCOME_MULTIPLIER = 7;

export const DEFAULT_LOAN_POLICIES: Array<Omit<LoanPolicy, "id"> & { id: string }> = [
  {
    id: "regulated_first_time",
    label: "규제지역 · 생애최초",
    loanRatio: UNLIMITED_RATIO,
    appraisalRatio: 0.4,
    regulatedArea: true,
    loanUnavailable: false,
    businessLoanOnly: false,
    sortOrder: 0,
  },
  {
    id: "regulated_no_house",
    label: "규제지역 · 무주택 일반",
    loanRatio: UNLIMITED_RATIO,
    appraisalRatio: 0.4,
    regulatedArea: true,
    loanUnavailable: false,
    businessLoanOnly: false,
    sortOrder: 1,
  },
  {
    id: "regulated_owner",
    label: "규제지역 · 1주택 이상",
    loanRatio: 0,
    appraisalRatio: 0,
    regulatedArea: true,
    loanUnavailable: true,
    businessLoanOnly: false,
    sortOrder: 2,
  },
  {
    id: "unregulated_first_time",
    label: "비규제지역 · 생애최초",
    loanRatio: 0.9,
    appraisalRatio: 0.9,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: false,
    sortOrder: 3,
  },
  {
    id: "unregulated_no_house",
    label: "비규제지역 · 무주택 일반",
    loanRatio: 0.8,
    appraisalRatio: 0.7,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: false,
    sortOrder: 4,
  },
  {
    id: "unregulated_owner",
    label: "비규제지역 · 1주택 이상(사업자대출)",
    loanRatio: 0.7,
    appraisalRatio: 0.7,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: true,
    sortOrder: 5,
  },
];

@Injectable()
export class LoanPolicyService implements OnModuleInit {
  constructor(
    @InjectRepository(LoanPolicy)
    private readonly loanPolicyRepo: Repository<LoanPolicy>,
    @InjectRepository(LoanSettings)
    private readonly loanSettingsRepo: Repository<LoanSettings>,
  ) {}

  async onModuleInit() {
    for (const defaults of DEFAULT_LOAN_POLICIES) {
      const exists = await this.loanPolicyRepo.findOne({ where: { id: defaults.id } });
      if (!exists) {
        await this.loanPolicyRepo.save(this.loanPolicyRepo.create(defaults));
      }
    }
  }

  findAll() {
    return this.loanPolicyRepo.find({ order: { sortOrder: "ASC" } });
  }

  async updatePolicy(
    id: string,
    input: { loanRatio: number; appraisalRatio: number },
  ) {
    const policy = await this.loanPolicyRepo.findOne({ where: { id } });
    if (!policy) {
      throw new NotFoundException("대출 정책을 찾을 수 없습니다.");
    }
    if (policy.loanUnavailable) {
      throw new BadRequestException("대출 불가 정책은 비율을 수정할 수 없습니다.");
    }
    policy.loanRatio = input.loanRatio;
    policy.appraisalRatio = input.appraisalRatio;
    return this.loanPolicyRepo.save(policy);
  }

  /** 소득 대비 대출 가능 배수(예: 7배). 관리자가 조정 가능한 전역 설정값. */
  async getIncomeLoanMultiplier(): Promise<number> {
    const row = await this.loanSettingsRepo.findOne({ where: { key: INCOME_MULTIPLIER_KEY } });
    return row?.value ?? DEFAULT_INCOME_MULTIPLIER;
  }

  async setIncomeLoanMultiplier(value: number): Promise<number> {
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException("소득 대비 대출 배수는 0보다 큰 값으로 입력해 주세요.");
    }
    const existing = await this.loanSettingsRepo.findOne({ where: { key: INCOME_MULTIPLIER_KEY } });
    if (existing) {
      existing.value = value;
      await this.loanSettingsRepo.save(existing);
    } else {
      await this.loanSettingsRepo.save(
        this.loanSettingsRepo.create({ key: INCOME_MULTIPLIER_KEY, value }),
      );
    }
    return value;
  }
}
