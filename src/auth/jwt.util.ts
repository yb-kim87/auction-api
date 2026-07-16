import jwt from "jsonwebtoken";
import type { CookieOptions, Response } from "express";
import { UserRole } from "../common/constants";

export const AUTH_TOKEN_COOKIE = "auc-token";
export const REFRESH_TOKEN_COOKIE = "auc-refresh-token";
/** refresh 쿠키는 재발급 엔드포인트에서만 전송되도록 경로를 제한해 탈취 노출면을 줄인다 */
export const REFRESH_TOKEN_PATH = "/auth/refresh";

const DEFAULT_SECRET = "auction-dev-jwt-secret-change-me";
const ACCESS_TOKEN_TTL_SECONDS = 60 * 30; // 30분
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30일

export interface AccessTokenPayload {
  sub: string;
  role: UserRole;
}

export interface RefreshTokenPayload {
  sub: string;
  role: UserRole;
  type: "refresh";
}

function jwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEFAULT_SECRET;
}

export function signAccessToken(username: string, role: UserRole): string {
  return jwt.sign({ sub: username, role }, jwtSecret(), {
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

export function signRefreshToken(username: string, role: UserRole): string {
  return jwt.sign({ sub: username, role, type: "refresh" }, jwtSecret(), {
    expiresIn: REFRESH_TOKEN_TTL_SECONDS,
  });
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
}
