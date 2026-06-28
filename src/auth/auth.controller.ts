import { Controller, Post, Body } from "@nestjs/common";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  login(@Body() body: { username?: string; password?: string }) {
    return this.authService.login(body.username ?? "", body.password ?? "");
  }

  @Post("signup")
  signup(
    @Body() body: { username?: string; password?: string; name?: string },
  ) {
    return this.authService.signup(
      body.username ?? "",
      body.password ?? "",
      body.name ?? "",
    );
  }
}
