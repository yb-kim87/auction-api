import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { SignupDto } from "./signup.dto";
import { signAuthToken } from "./jwt.util";
import { validateInvestmentSignupFields } from "./investment-validation.util";

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async login(username: string, password: string, persistent = false) {
    const user = await this.usersService.findByUsername(username.trim());
    if (!user || user.password !== password) {
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    return {
      token: signAuthToken(user.username, user.role, persistent),
      redirectRole: user.role,
    };
  }

  async signup(body: SignupDto) {
    const username = body.username?.trim() ?? "";
    const password = body.password?.trim() ?? "";
    const name = body.name?.trim() ?? "";
    const phone = (body.phone ?? "").replace(/\s+/g, "").trim();

    if (!username || !password || !name || !phone) {
      throw new ConflictException("아이디, 비밀번호, 이름, 전화번호를 입력해 주세요.");
    }
    if (password.length < 4) {
      throw new ConflictException("비밀번호는 4자 이상이어야 합니다.");
    }
    if (!/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phone)) {
      throw new ConflictException("전화번호 형식을 확인해 주세요. (예: 010-1234-5678)");
    }

    const investment = validateInvestmentSignupFields(body);

    await this.usersService.createMember({
      username,
      password,
      name,
      phone,
      ...investment,
    });

    return { ok: true as const };
  }
}
