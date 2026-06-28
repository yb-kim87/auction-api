import { IncomingHttpHeaders } from "http";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { UserRole } from "./constants";

export interface AuthContext {
  username: string;
  role: UserRole | "";
}

export function getAuthContext(headers: IncomingHttpHeaders): AuthContext {
  const username = String(headers["x-auction-user"] ?? "").trim();
  const role = String(headers["x-auction-role"] ?? "").trim() as UserRole | "";
  return { username, role };
}

export function requireAuth(ctx: AuthContext) {
  if (!ctx.username) {
    throw new UnauthorizedException("로그인이 필요합니다.");
  }
}

export function requireAdmin(ctx: AuthContext) {
  if (ctx.role !== UserRole.ADMIN) {
    throw new ForbiddenException("관리자 권한이 필요합니다.");
  }
}

export function requireConsultant(ctx: AuthContext) {
  if (ctx.role !== UserRole.CONSULTANT) {
    throw new ForbiddenException("컨설턴트 권한이 필요합니다.");
  }
}

export function requireConsultantOrAdmin(ctx: AuthContext) {
  if (ctx.role !== UserRole.CONSULTANT && ctx.role !== UserRole.ADMIN) {
    throw new ForbiddenException("접근 권한이 없습니다.");
  }
}
