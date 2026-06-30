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
  }

  findAll() {
    return this.userRepo.find({ order: { createdAt: "DESC" } });
  }

  findByUsername(username: string) {
    return this.userRepo.findOne({ where: { username } });
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

    if (dto.targetReturn !== undefined) {
      const next = dto.targetReturn.trim();
      if (!next) {
        throw new BadRequestException("목표 수익을 입력해 주세요.");
      }
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
    investableFunds: string;
    existingLoanAmount: string;
    housingCount: number;
    investmentGoal: string;
    targetReturn: string;
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
        role: UserRole.MEMBER,
        investableFunds: input.investableFunds,
        existingLoanAmount: input.existingLoanAmount,
        housingCount: input.housingCount,
        investmentGoal: input.investmentGoal,
        targetReturn: input.targetReturn,
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

  sanitize(user: User) {
    const { password: _password, ...rest } = user;
    return rest;
  }
}
