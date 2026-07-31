import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { UsersService } from "../users/users.service";
import type { SignupDto } from "./signup.dto";
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from "./jwt.util";
import { validateInvestmentSignupFields } from "./investment-validation.util";
import { UserRole } from "../common/constants";

/**
 * 계정당 동시 로그인 1개 제한 대상 역할. 관리자/컨설턴트는 업무상 여러
 * 기기를 오가야 해서 제외하고, 수강생 계정만 적용한다(사용자 요청,
 * 2026-07-31: "수강생이 로그인을 했을때 1계정으로 1명만 사용할 수
 * 있게").
 */
const SINGLE_SESSION_ROLES: ReadonlySet<UserRole> = new Set([
  UserRole.STUDENT,
  UserRole.CONSULTING_STUDENT,
  UserRole.MEMBER,
]);

/**
 * "이미 로그인된 상태"로 볼 유휴 허용 시간. 이 시간 동안 refresh 호출
 * (=탭을 열어둔 정상 사용)이 없으면 방치된 세션으로 보고 자리를
 * 비워 새 로그인을 허용한다(사용자 확정, 2026-07-31).
 */
const SESSION_IDLE_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2시간

@Injectable()
export class AuthService {
  constructor(private readonly usersService: UsersService) {}

  async login(username: string, password: string) {
    const user = await this.usersService.findByUsername(username.trim());
    if (!user || user.password !== password) {
      throw new UnauthorizedException("아이디 또는 비밀번호가 올바르지 않습니다.");
    }

    if (SINGLE_SESSION_ROLES.has(user.role) && this.hasActiveSession(user)) {
      throw new ConflictException(
        "이미 다른 기기에서 로그인 중인 계정입니다. 그 기기에서 로그아웃하거나, 사용을 멈춘 뒤 잠시 후 다시 시도해 주세요.",
      );
    }

    const sid = SINGLE_SESSION_ROLES.has(user.role) ? randomUUID() : undefined;
    if (sid) {
      await this.usersService.setSession(user.id, sid, new Date());
    }

    return {
      accessToken: signAccessToken(user.username, user.role, sid),
      refreshToken: signRefreshToken(user.username, user.role, sid),
      redirectRole: user.role,
    };
  }

  private hasActiveSession(user: { currentSessionId: string | null; sessionLastActiveAt: Date | null }): boolean {
    if (!user.currentSessionId || !user.sessionLastActiveAt) return false;
    const idleMs = Date.now() - new Date(user.sessionLastActiveAt).getTime();
    return idleMs < SESSION_IDLE_TIMEOUT_MS;
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

    if (SINGLE_SESSION_ROLES.has(user.role)) {
      // 다른 기기에서 새로 로그인해 세션을 넘겨받았다면(sid 불일치) 이 refresh
      // 토큰은 더 이상 유효한 세션의 것이 아니므로 거부한다.
      if (!payload.sid || user.currentSessionId !== payload.sid) {
        throw new UnauthorizedException(
          "다른 기기에서 로그인되어 이 세션은 종료되었습니다. 다시 로그인해 주세요.",
        );
      }
      // 정상 활동(탭을 열어둔 채 access 토큰이 갱신됨) 중이므로 유휴 타이머를 갱신한다.
      await this.usersService.touchSession(user.id, new Date());
    }

    return {
      accessToken: signAccessToken(user.username, user.role, payload.sid),
      refreshToken: signRefreshToken(user.username, user.role, payload.sid),
      redirectRole: user.role,
    };
  }

  /** 로그아웃 시 세션 점유를 해제해 즉시 다른 기기에서 로그인할 수 있게 한다. */
  async logout(accessToken: string | null): Promise<void> {
    if (!accessToken) return;
    const payload = verifyAccessToken(accessToken);
    if (!payload) return;
    const user = await this.usersService.findByUsername(payload.sub);
    if (!user || !SINGLE_SESSION_ROLES.has(user.role)) return;
    // 이미 다른 기기가 새 로그인으로 세션을 가져간 뒤라면(sid 불일치) 그 세션을
    // 건드리지 않는다 — 이 로그아웃은 예전 세션의 뒷정리일 뿐이다.
    if (payload.sid && user.currentSessionId !== payload.sid) return;
    await this.usersService.clearSession(user.id);
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
