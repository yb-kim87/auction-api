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
    roomDeductionTarget: "none",
    sortOrder: 0,
  },
  {
    id: "regulated_no_house",
    label: "규제지역 · 무주택",
    loanRatio: UNLIMITED_RATIO,
    appraisalRatio: 0.4,
    regulatedArea: true,
    loanUnavailable: false,
    businessLoanOnly: false,
    roomDeductionTarget: "none",
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
    roomDeductionTarget: "none",
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
    roomDeductionTarget: "none",
    sortOrder: 3,
  },
  {
    id: "unregulated_no_house",
    label: "비규제지역 · 무주택",
    loanRatio: 0.8,
    appraisalRatio: 0.7,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: false,
    roomDeductionTarget: "none",
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
    roomDeductionTarget: "none",
    sortOrder: 5,
  },
  {
    id: "officetel",
    label: "오피스텔(공시가·주택수 무관)",
    loanRatio: 0.9,
    appraisalRatio: 0.8,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: false,
    roomDeductionTarget: "none",
    sortOrder: 6,
  },
  {
    id: "low_price_nonmetro_apartment",
    label: "비수도권 공시가 2억 이하 주택(아파트·빌라 등, 주택수 무관)",
    loanRatio: 0.9,
    appraisalRatio: 0.8,
    regulatedArea: false,
    loanUnavailable: false,
    businessLoanOnly: false,
    roomDeductionTarget: "none",
    sortOrder: 7,
  },
];

const LEGACY_SPECIAL_POLICY_ID = "officetel_or_low_price_nonmetro";

@Injectable()
export class LoanPolicyService implements OnModuleInit {
  constructor(
    @InjectRepository(LoanPolicy)
    private readonly loanPolicyRepo: Repository<LoanPolicy>,
    @InjectRepository(LoanSettings)
    private readonly loanSettingsRepo: Repository<LoanSettings>,
  ) {}

  async onModuleInit() {
    // 기존 통합 특례 정책을 두 정책으로 분리한다. 관리자가 저장한 비율과 방공제
    // 기준은 그대로 복사해 배포 직후 계산 결과가 달라지지 않게 한다.
    const legacySpecial = await this.loanPolicyRepo.findOne({
      where: { id: LEGACY_SPECIAL_POLICY_ID },
    });

    for (const defaults of DEFAULT_LOAN_POLICIES) {
      const exists = await this.loanPolicyRepo.findOne({ where: { id: defaults.id } });
      if (!exists) {
        const initial =
          legacySpecial && (defaults.id === "officetel" || defaults.id === "low_price_nonmetro_apartment")
            ? {
                ...defaults,
                loanRatio: legacySpecial.loanRatio,
                appraisalRatio: legacySpecial.appraisalRatio,
                loanUnavailable: legacySpecial.loanUnavailable,
                roomDeductionTarget: legacySpecial.roomDeductionTarget,
              }
            : defaults;
        await this.loanPolicyRepo.save(this.loanPolicyRepo.create(initial));
        continue;
      }
      // 관리자가 조정하는 loanRatio/appraisalRatio/loanUnavailable은 보존하고,
      // 코드로 관리하는 라벨·정렬순서 등 메타데이터만 최신 정의로 동기화한다.
      if (
        exists.label !== defaults.label ||
        exists.sortOrder !== defaults.sortOrder ||
        exists.regulatedArea !== defaults.regulatedArea ||
        exists.businessLoanOnly !== defaults.businessLoanOnly
      ) {
        exists.label = defaults.label;
        exists.sortOrder = defaults.sortOrder;
        exists.regulatedArea = defaults.regulatedArea;
        exists.businessLoanOnly = defaults.businessLoanOnly;
        await this.loanPolicyRepo.save(exists);
      }
    }
  }

  findAll() {
    const knownPolicyIds = new Set(DEFAULT_LOAN_POLICIES.map((policy) => policy.id));
    return this.loanPolicyRepo
      .find({ order: { sortOrder: "ASC" } })
      .then((policies) => policies.filter((policy) => knownPolicyIds.has(policy.id)));
  }

  async updatePolicy(
    id: string,
    input: {
      loanRatio: number;
      appraisalRatio: number;
      loanUnavailable: boolean;
      roomDeductionTarget?: "none" | "appraisal" | "bid" | "both";
    },
  ) {
    const policy = await this.loanPolicyRepo.findOne({ where: { id } });
    if (!policy) {
      throw new NotFoundException("대출 정책을 찾을 수 없습니다.");
    }
    policy.loanRatio = input.loanRatio;
    policy.appraisalRatio = input.appraisalRatio;
    policy.loanUnavailable = input.loanUnavailable;
    if (input.roomDeductionTarget !== undefined) policy.roomDeductionTarget = input.roomDeductionTarget;
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
