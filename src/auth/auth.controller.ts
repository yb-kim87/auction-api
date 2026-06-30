import { Controller, Post, Body } from "@nestjs/common";
import { AuthService } from "./auth.service";
import type { SignupDto } from "./signup.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: { username?: string; password?: string }) {
    return this.authService.login(body.username ?? "", body.password ?? "");
  }

  @Post("signup")
  signup(@Body() body: SignupDto) {
    return this.authService.signup(body);
  }
}
