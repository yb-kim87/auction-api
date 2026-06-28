import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { UsersService } from "../users/users.service";

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

  async signup(username: string, password: string, name: string) {
    if (!username.trim() || !password.trim() || !name.trim()) {
      throw new ConflictException("모든 항목을 입력해 주세요.");
    }
    if (password.length < 4) {
      throw new ConflictException("비밀번호는 4자 이상이어야 합니다.");
    }

    const user = await this.usersService.createMember(
      username.trim(),
      password,
      name.trim(),
    );
    return this.usersService.sanitize(user);
  }
}
