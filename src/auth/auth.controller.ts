import { Controller, Post, Body, Res } from "@nestjs/common";
import type { Response } from "express";
import { AuthService } from "./auth.service";
import type { SignupDto } from "./signup.dto";
import { clearAuthTokenCookie, setAuthTokenCookie } from "./jwt.util";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  async login(
    @Body() body: { username?: string; password?: string; remember?: boolean },
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(
      body.username ?? "",
      body.password ?? "",
      Boolean(body.remember),
    );
    setAuthTokenCookie(res, result.token, Boolean(body.remember));
    return { ok: true };
  }

  @Post("logout")
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthTokenCookie(res);
    return { ok: true };
  }

  @Post("signup")
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body);
  }
}
