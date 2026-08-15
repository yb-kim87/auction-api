import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { WebinarEmailLead } from "./webinar-email-lead.entity";
import { hashPassword } from "./password.util";

export interface JoinEmailInput {
  email: string;
  password: string;
  passwordConfirm: string;
  name: string;
  gender?: string;
  phone: string;
  homepage?: string;
  address?: string;
  addressDetail?: string;
  recommendCode?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class WebinarEmailAuthService {
  constructor(
    @InjectRepository(WebinarEmailLead)
    private readonly repo: Repository<WebinarEmailLead>,
  ) {}

  async join(input: JoinEmailInput): Promise<WebinarEmailLead> {
    const email = input.email?.trim().toLowerCase() ?? "";
    const name = input.name?.trim() ?? "";
    const phone = input.phone?.trim() ?? "";
    const password = input.password ?? "";

    if (!EMAIL_RE.test(email)) throw new BadRequestException("올바른 이메일을 입력해 주세요.");
    if (!name) throw new BadRequestException("이름을 입력해 주세요.");
    if (!phone) throw new BadRequestException("연락처를 입력해 주세요.");
    if (password.length < 4) throw new BadRequestException("비밀번호는 4자 이상이어야 합니다.");
    if (password !== input.passwordConfirm) throw new BadRequestException("비밀번호가 일치하지 않습니다.");

    const existing = await this.repo.findOne({ where: { email } });
    if (existing) throw new ConflictException("이미 가입된 이메일입니다.");

    const lead = this.repo.create({
      email,
      passwordHash: hashPassword(password),
      name,
      gender: input.gender ?? "",
      phone,
      homepage: input.homepage ?? "",
      address: input.address ?? "",
      addressDetail: input.addressDetail ?? "",
      recommendCode: input.recommendCode ?? "",
    });
    return this.repo.save(lead);
  }

  /** 관리자 페이지의 "웨비나 신청자" 탭에서 사용. */
  async findAll(): Promise<WebinarEmailLead[]> {
    return this.repo.find({ order: { createdAt: "DESC" } });
  }
}
