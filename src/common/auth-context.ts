import { IncomingHttpHeaders } from "http";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import {
  AUTH_TOKEN_COOKIE,
  parseCookieValue,
  verifyAccessToken,
} from "../auth/jwt.util";
import { UserRole } from "./constants";

export interface AuthContext {
  username: string;
  role: UserRole | "";
}

export function getAuthContext(headers: IncomingHttpHeaders): AuthContext {
  const cookieHeader = String(headers.cookie ?? headers.Cookie ?? "");
  const token = parseCookieValue(cookieHeader, AUTH_TOKEN_COOKIE);
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload?.sub) {
      return {
        username: payload.sub,
        role: payload.role as UserRole,
      };
    }
  }

  return { username: "", role: "" };
}

export function requireAuth(ctx: AuthContext) {
  if (!ctx.username) {
    throw new UnauthorizedException("로그인이 필요합니다.");
  }
}

export function requireAdmin(ctx: AuthContext) {
  requireAuth(ctx);
  if (ctx.role !== UserRole.ADMIN) {
    throw new ForbiddenException("관리자 권한이 필요합니다.");
  }
}

export function requireConsultant(ctx: AuthContext) {
  requireAuth(ctx);
  if (ctx.role !== UserRole.CONSULTANT) {
    throw new ForbiddenException("컨설턴트 권한이 필요합니다.");
  }
}

export function requireConsultantOrAdmin(ctx: AuthContext) {
  requireAuth(ctx);
  if (ctx.role !== UserRole.CONSULTANT && ctx.role !== UserRole.ADMIN) {
    throw new ForbiddenException("접근 권한이 없습니다.");
  }
}

const SEARCH_ACCESS_ROLES: UserRole[] = [
  UserRole.STUDENT,
  UserRole.CONSULTING_STUDENT,
  UserRole.CONSULTANT,
  UserRole.ADMIN,
];

export function requireSearchAccess(ctx: AuthContext) {
  requireAuth(ctx);
  if (!ctx.role || !SEARCH_ACCESS_ROLES.includes(ctx.role as UserRole)) {
    throw new ForbiddenException("AI 분석은 수강생 이상 등급에서 이용할 수 있습니다.");
  }
}
