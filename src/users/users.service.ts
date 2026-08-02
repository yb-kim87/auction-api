import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";
import { UserRole } from "../common/constants";
import type { UpdateProfileDto } from "./update-profile.dto";

/** 임시 조치(2026-08-02): 이 명단으로 가입하는 회원은 가입과 동시에
 * "OT수강생" 등급을 자동 부여해 OT영상을 바로 볼 수 있게 한다(관리자가
 * 수동으로 등급을 바꿔줄 필요 없이). 이름이 완전히 일치해야 하며,
 * 용도가 끝나면(대상자들이 전부 가입 완료되면) 이 목록/분기를 지워도
 * 된다 — 회원권한 관리 화면에서 언제든 수동으로도 등급을 줄 수 있다. */
const OT_AUTO_UPGRADE_NAMES = new Set(["현영근", "권오상", "김동우", "정혜원", "김수진"]);

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async onModuleInit() {
    const admin = await this.userRepo.findOne({ where: { username: "admin" } });
    if (!admin) {
      await this.userRepo.save(
        this.userRepo.create({
          username: "admin",
          password: "admin",
          name: "관리자",
          role: UserRole.ADMIN,
        }),
      );
    }

    const consultant = await this.userRepo.findOne({
      where: { username: "young" },
    });
    if (!consultant) {
      await this.userRepo.save(
        this.userRepo.create({
          username: "young",
          password: "young",
          name: "컨설턴트",
          role: UserRole.CONSULTANT,
        }),
      );
    }

    const uiConsultant = await this.userRepo.findOne({
      where: { username: "ui" },
    });
    if (!uiConsultant) {
      await this.userRepo.save(
        this.userRepo.create({
          username: "ui",
          password: "ui",
          name: "컨설턴트",
          role: UserRole.CONSULTANT,
        }),
      );
    }
  }

  findAll() {
    return this.userRepo.find({ order: { createdAt: "DESC" } });
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
  }

  /** 관리자가 이름/아이디/전화번호로 회원을 찾는 검색(email 컬럼이 없어
   * 이 세 가지만 지원). 강의 수강권 부여 화면에서 사용. */
  async searchUsers(query: string) {
    const q = query.trim();
    if (!q) return [];
    const users = await this.userRepo
      .createQueryBuilder("user")
      .where("user.username ILIKE :q", { q: `%${q}%` })
      .orWhere("user.name ILIKE :q", { q: `%${q}%` })
      .orWhere("user.phone ILIKE :q", { q: `%${q}%` })
      .orderBy("user.createdAt", "DESC")
      .limit(20)
      .getMany();
    return users.map((u) => this.sanitize(u));
  }

  async getProfileByUsername(username: string) {
    const user = await this.findByUsername(username);
    if (!user) {
      throw new NotFoundException("회원 정보를 찾을 수 없습니다.");
    }
    return this.sanitize(user);
  }

  async updateProfile(username: string, dto: UpdateProfileDto) {
    const user = await this.findByUsername(username);
    if (!user) {
      throw new NotFoundException("회원 정보를 찾을 수 없습니다.");
    }

    let changed = false;

    if (dto.name !== undefined) {
      const nextName = dto.name.trim();
      if (!nextName) {
        throw new BadRequestException("이름을 입력해 주세요.");
      }
      if (user.name !== nextName) {
        user.name = nextName;
        changed = true;
      }
    }

    if (dto.investableFunds !== undefined) {
      const next = dto.investableFunds.trim();
      if (!next) {
        throw new BadRequestException("투자가능자금을 입력해 주세요.");
      }
      if (user.investableFunds !== next) {
        user.investableFunds = next;
        changed = true;
      }
    }

    if (dto.existingLoanAmount !== undefined) {
      const next = dto.existingLoanAmount.trim();
      if (!next) {
        throw new BadRequestException("기존대출금액을 입력해 주세요.");
      }
      if (user.existingLoanAmount !== next) {
        user.existingLoanAmount = next;
        changed = true;
      }
    }

    if (dto.housingCount !== undefined) {
      const nextCount =
        typeof dto.housingCount === "number"
          ? dto.housingCount
          : Number.parseInt(String(dto.housingCount), 10);
      if (Number.isNaN(nextCount) || nextCount < 0) {
        throw new BadRequestException("주택수는 0 이상의 숫자로 입력해 주세요.");
      }
      if (user.housingCount !== nextCount) {
        user.housingCount = nextCount;
        changed = true;
      }
    }

    if (dto.creditScore !== undefined) {
      const next = dto.creditScore.trim();
      if (!next) {
        throw new BadRequestException("신용점수를 선택해 주세요.");
      }
      if (user.creditScore !== next) {
        user.creditScore = next;
        changed = true;
      }
    }

    if (dto.annualNetIncome !== undefined) {
      const next = dto.annualNetIncome.trim();
      if (!next) {
        throw new BadRequestException("연순소득을 선택해 주세요.");
      }
      if (user.annualNetIncome !== next) {
        user.annualNetIncome = next;
        changed = true;
      }
    }

    if (dto.targetReturn !== undefined) {
      // 목표 수익은 선택 항목 — 빈 값으로 저장하면 목표수익 필터 없이
      // 추천된다(recommendation-engine.service.ts: targetReturnWon==null 처리).
      const next = dto.targetReturn.trim();
      if (user.targetReturn !== next) {
        user.targetReturn = next;
        changed = true;
      }
    }

    if (dto.investmentGoal !== undefined) {
      const next = dto.investmentGoal.trim();
      if (!next) {
        throw new BadRequestException("투자목표를 입력해 주세요.");
      }
      if (user.investmentGoal !== next) {
        user.investmentGoal = next;
        changed = true;
      }
    }

    if (dto.firstTimeBuyer !== undefined) {
      const next = Boolean(dto.firstTimeBuyer);
      if (user.firstTimeBuyer !== next) {
        user.firstTimeBuyer = next;
        changed = true;
      }
    }

    const nextPassword = dto.newPassword?.trim() ?? "";
    if (nextPassword) {
      const currentPassword = dto.currentPassword?.trim() ?? "";
      if (!currentPassword) {
        throw new BadRequestException("현재 비밀번호를 입력해 주세요.");
      }
      if (user.password !== currentPassword) {
        throw new UnauthorizedException("현재 비밀번호가 올바르지 않습니다.");
      }
      if (nextPassword.length < 4) {
        throw new BadRequestException("새 비밀번호는 4자 이상이어야 합니다.");
      }
      if (user.password !== nextPassword) {
        user.password = nextPassword;
        changed = true;
      }
    }

    if (!changed) {
      throw new BadRequestException("변경할 내용이 없습니다.");
    }

    const saved = await this.userRepo.save(user);
    return this.sanitize(saved);
  }

  async createMember(input: {
    username: string;
    password: string;
    name: string;
    phone: string;
    investableFunds: string;
    existingLoanAmount: string;
    housingCount: number;
    creditScore: string;
    annualNetIncome: string;
    investmentGoal: string;
    targetReturn: string;
    firstTimeBuyer: boolean;
  }) {
    const exists = await this.findByUsername(input.username);
    if (exists) {
      throw new ConflictException("이미 사용 중인 아이디입니다.");
    }

    return this.userRepo.save(
      this.userRepo.create({
        username: input.username,
        password: input.password,
        name: input.name,
        phone: input.phone,
        role: OT_AUTO_UPGRADE_NAMES.has(input.name.trim())
          ? UserRole.OT_STUDENT
          : UserRole.MEMBER,
        investableFunds: input.investableFunds,
        existingLoanAmount: input.existingLoanAmount,
        housingCount: input.housingCount,
        creditScore: input.creditScore,
        annualNetIncome: input.annualNetIncome,
        investmentGoal: input.investmentGoal,
        targetReturn: input.targetReturn,
        firstTimeBuyer: input.firstTimeBuyer,
      }),
    );
  }

  async updateRole(id: string, role: UserRole) {
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException("회원을 찾을 수 없습니다.");
    }
    if (user.username === "admin") {
      throw new ConflictException("관리자 계정의 권한은 변경할 수 없습니다.");
    }

    user.role = role;
    return this.userRepo.save(user);
  }

  async updateAiAnalysisLimit(id: string, limit: number) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new BadRequestException(
        "AI 분석 제한 횟수는 0 이상의 정수로 입력해 주세요.",
      );
    }
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException("회원을 찾을 수 없습니다.");
    }

    user.aiAnalysisLimit = limit;
    return this.userRepo.save(user);
  }

  async incrementAiAnalysisUsage(username: string) {
    await this.userRepo.increment({ username }, "aiAnalysisUsed", 1);
  }

  /** 계정당 동시 로그인 1개 제한: 로그인 시 새 세션을 점유한다. */
  async setSession(id: string, sessionId: string, activeAt: Date) {
    await this.userRepo.update(
      { id },
      { currentSessionId: sessionId, sessionLastActiveAt: activeAt },
    );
  }

  /** 세션 유휴 타이머 갱신(정상 활동 중임을 표시). */
  async touchSession(id: string, activeAt: Date) {
    await this.userRepo.update({ id }, { sessionLastActiveAt: activeAt });
  }

  /** 로그아웃 등으로 세션 점유를 해제한다. */
  async clearSession(id: string) {
    await this.userRepo.update({ id }, { currentSessionId: null, sessionLastActiveAt: null });
  }

  sanitize(user: User) {
    const { password: _password, ...rest } = user;
    return rest;
  }
}
