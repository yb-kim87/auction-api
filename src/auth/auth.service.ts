import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { SignupDto } from "./signup.dto";

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async login(username: string, password: string) {
    const user = await this.usersService.findByUsername(username.trim());
    if (!user || user.password !== password) {
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    return this.usersService.sanitize(user);
  }

  async signup(body: SignupDto) {
    const username = body.username?.trim() ?? "";
    const password = body.password?.trim() ?? "";
    const name = body.name?.trim() ?? "";
    const investableFunds = body.investableFunds?.trim() ?? "";
    const existingLoanAmount = body.existingLoanAmount?.trim() ?? "";
    const investmentGoal = body.investmentGoal?.trim() ?? "";
    const targetReturn = body.targetReturn?.trim() ?? "";
    const housingCount =
      typeof body.housingCount === "number"
        ? body.housingCount
        : Number.parseInt(String(body.housingCount ?? ""), 10);

    if (
      !username ||
      !password ||
      !name ||
      !investableFunds ||
      !existingLoanAmount ||
      !investmentGoal ||
      !targetReturn ||
      Number.isNaN(housingCount)
    ) {
      throw new ConflictException("모든 항목을 입력해 주세요.");
    }
    if (housingCount < 0) {
      throw new ConflictException("주택수는 0 이상으로 입력해 주세요.");
    }
    if (password.length < 4) {
      throw new ConflictException("비밀번호는 4자 이상이어야 합니다.");
    }

    const user = await this.usersService.createMember({
      username,
      password,
      name,
      investableFunds,
      existingLoanAmount,
      housingCount,
      investmentGoal,
      targetReturn,
    });
    return this.usersService.sanitize(user);
  }
}
