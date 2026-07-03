import jwt from "jsonwebtoken";
import type { CookieOptions, Response } from "express";
import { UserRole } from "../common/constants";

export const AUTH_TOKEN_COOKIE = "auc-token";

const DEFAULT_SECRET = "auction-dev-jwt-secret-change-me";
const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30;

export interface JwtPayload {
  sub: string;
  role: UserRole;
}

function jwtSecret(): string {
  return process.env.JWT_SECRET?.trim() || DEFAULT_SECRET;
}

export function signAuthToken(
  username: string,
  role: UserRole,
  persistent = false,
): string {
  const expiresIn = persistent ? THIRTY_DAYS_SECONDS : 60 * 60 * 24;
  return jwt.sign({ sub: username, role }, jwtSecret(), { expiresIn });
}

export function verifyAuthToken(token: string): JwtPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret());
    if (
      typeof payload !== "object" ||
      payload === null ||
      typeof (payload as JwtPayload).sub !== "string" ||
      typeof (payload as JwtPayload).role !== "string"
    ) {
      return null;
    }
    return payload as JwtPayload;
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

function baseCookieOptions(persistent: boolean): CookieOptions {
  const secure = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(persistent ? { maxAge: THIRTY_DAYS_SECONDS * 1000 } : {}),
  };
}

export function setAuthTokenCookie(
  res: Response,
  token: string,
  persistent = false,
): void {
  res.cookie(AUTH_TOKEN_COOKIE, token, baseCookieOptions(persistent));
}

export function clearAuthTokenCookie(res: Response): void {
  res.clearCookie(AUTH_TOKEN_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}
