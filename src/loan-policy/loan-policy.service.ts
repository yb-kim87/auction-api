import { Injectable, NotFoundException, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { LoanPolicy } from "./loan-policy.entity";

export const DEFAULT_LOAN_POLICIES: Array<Omit<LoanPolicy, "id"> & { id: string }> = [
  { id: "first_time", label: "생애최초 (무주택 + 생애최초)", loanRatio: 0.9, sortOrder: 0 },
  { id: "no_house", label: "무주택 일반", loanRatio: 0.8, sortOrder: 1 },
  { id: "one_house", label: "1주택", loanRatio: 0.7, sortOrder: 2 },
  { id: "multi_house", label: "2주택 이상", loanRatio: 0.7, sortOrder: 3 },
];

@Injectable()
export class LoanPolicyService implements OnModuleInit {
  constructor(
    @InjectRepository(LoanPolicy)
    private readonly loanPolicyRepo: Repository<LoanPolicy>,
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

  async updateRatio(id: string, loanRatio: number) {
    const policy = await this.loanPolicyRepo.findOne({ where: { id } });
    if (!policy) {
      throw new NotFoundException("대출 정책을 찾을 수 없습니다.");
    }
    policy.loanRatio = loanRatio;
    return this.loanPolicyRepo.save(policy);
  }
}
