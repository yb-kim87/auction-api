import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";
import type { SignupDto } from "./signup.dto";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt.util";
import { validateInvestmentSignupFields } from "./investment-validation.util";

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async login(username: string, password: string) {
    const user = await this.usersService.findByUsername(username.trim());
    if (!user || user.password !== password) {
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    return {
      accessToken: signAccessToken(user.username, user.role),
      refreshToken: signRefreshToken(user.username, user.role),
      redirectRole: user.role,
    };
  }

  /** refresh 토큰을 검증하고 새 access/refresh 토큰 쌍을 발급한다(로테이션). */
  async refresh(refreshToken: string) {
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new UnauthorizedException("세션이 만료되었습니다. 다시 로그인해 주세요.");
    }
    // 탈취된 refresh 토큰으로 재발급받는 것을 막기 위해, 매 요청마다 사용자가
    // 여전히 유효한지(탈퇴/비활성화 등) 재확인 후 발급한다.
    const user = await this.usersService.findByUsername(payload.sub);
    if (!user) {
      throw new UnauthorizedException("세션이 만료되었습니다. 다시 로그인해 주세요.");
    }

    return {
      accessToken: signAccessToken(user.username, user.role),
      refreshToken: signRefreshToken(user.username, user.role),
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
