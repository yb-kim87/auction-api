import jwt from "jsonwebtoken";
import type { CookieOptions, Response } from "express";
import { UserRole } from "../common/constants";

export const AUTH_TOKEN_COOKIE = "auc-token";
export const REFRESH_TOKEN_COOKIE = "auc-refresh-token";
/**
 * refresh 쿠키 경로. 예전엔 "/auth/refresh"로 좁혀 탈취 노출면을 줄였지만,
 * 그 결과 Next.js 미들웨어가 /admin 등으로 이동할 때 access 토큰이 만료됐어도
 * 브라우저가 refresh 쿠키를 함께 실어주지 않아(경로 불일치) 재발급 자체가
 * 불가능해지고 매번 로그인 화면으로 튕기는 문제가 있었다(2026-07-20).
 * "/"로 넓혀 모든 요청에 실리게 해야 미들웨어가 재발급을 시도할 수 있다.
 */
export const REFRESH_TOKEN_PATH = "/";

const DEFAULT_SECRET = "auction-dev-jwt-secret-change-me";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 30; // 30분
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
  /** 계정당 동시 로그인 1개 제한에 쓰는 세션 식별자(로그인 시 발급, 없으면 제한 미적용 대상). */
  sid?: string;
}

export interface RefreshTokenPayload {
  sub: string;
  role: UserRole;
  type: "refresh";
  sid?: string;
}

function jwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEFAULT_SECRET;
}

export function signAccessToken(username: string, role: UserRole, sid?: string): string {
  return jwt.sign({ sub: username, role, ...(sid ? { sid } : {}) }, jwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function signRefreshToken(username: string, role: UserRole, sid?: string): string {
  return jwt.sign(
    { sub: username, role, type: "refresh", ...(sid ? { sid } : {}) },
    jwtSecret(),
    { expiresIn: REFRESH_TOKEN_TTL_SECONDS },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as AccessTokenPayload).sub !== "string" ||
      typeof (payload as AccessTokenPayload).role !== "string" ||
      (payload as { type?: string }).type === "refresh"
    ) {
      return null;
    }
    return payload as AccessTokenPayload;
  } catch {
    return null;
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as RefreshTokenPayload).sub !== "string" ||
      typeof (payload as RefreshTokenPayload).role !== "string" ||
      (payload as { type?: string }).type !== "refresh"
    ) {
      return null;
    }
    return payload as RefreshTokenPayload;
  } catch {
    return null;
  }
}

export function parseCookieValue(
  cookieHeader: string | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  const pattern = new RegExp(`(?:^|;\\s*)${name}=([^;]*)`);
  const match = cookieHeader.match(pattern);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function baseCookieOptions(path: string): CookieOptions {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path,
  };
}

export function setAccessTokenCookie(res: Response, token: string): void {
  res.cookie(AUTH_TOKEN_COOKIE, token, {
    ...baseCookieOptions("/"),
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function setRefreshTokenCookie(res: Response, token: string): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    ...baseCookieOptions(REFRESH_TOKEN_PATH),
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(AUTH_TOKEN_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: REFRESH_TOKEN_PATH,
  });
  // 예전 path=/auth/refresh로 발급된 쿠키가 브라우저에 남아있는 사용자도
  // 로그아웃 시 함께 정리되도록, 옛 경로로도 한 번 더 지운다.
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/auth/refresh",
  });
}
