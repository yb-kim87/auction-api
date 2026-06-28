import {
  Injectable,
  OnModuleInit,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";
import { UserRole } from "../common/constants";

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

  async createMember(username: string, password: string, name: string) {
    const exists = await this.findByUsername(username);
    if (exists) {
      throw new ConflictException("이미 사용 중인 아이디입니다.");
    }

    return this.userRepo.save(
      this.userRepo.create({
        username,
        password,
        name,
        role: UserRole.MEMBER,
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
