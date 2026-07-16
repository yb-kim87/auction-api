import { Controller, Post, Body, Res, Req, UnauthorizedException } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import type { SignupDto } from "./signup.dto";
import {
  clearAuthCookies,
  parseCookieValue,
  REFRESH_TOKEN_COOKIE,
  setAccessTokenCookie,
  setRefreshTokenCookie,
} from "./jwt.util";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { username?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(body.username ?? "", body.password ?? "");
    setAccessTokenCookie(res, result.accessToken);
    setRefreshTokenCookie(res, result.refreshToken);
    return { ok: true };
  }

  /** access 토큰 만료 시 프론트가 자동으로 호출해 새 access/refresh 토큰을 받는다. */
  @Post("refresh")
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieHeader = String(req.headers.cookie ?? "");
    const refreshToken = parseCookieValue(cookieHeader, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException("세션이 만료되었습니다. 다시 로그인해 주세요.");
    }
    const result = await this.authService.refresh(refreshToken);
    setAccessTokenCookie(res, result.accessToken);
    setRefreshTokenCookie(res, result.refreshToken);
    return { ok: true };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookies(res);
    return { ok: true };
  }

  @Post("signup")
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body);
  }
}
