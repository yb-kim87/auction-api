import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { RequestLogWriterService } from "./request-log-writer.service";
import { AUTH_TOKEN_COOKIE, parseCookieValue, verifyAccessToken } from "../auth/jwt.util";

function verifiedProxyIdentity(req: Request): { ip: string; userAgent: string } | null {
  const secret = process.env.SECURITY_PROXY_SECRET?.trim() ?? "";
  const ip = String(req.headers["x-auction-client-ip"] ?? "").trim();
  const userAgent = String(req.headers["x-auction-client-ua"] ?? "");
  const timestamp = String(req.headers["x-auction-proxy-ts"] ?? "").trim();
  const signature = String(req.headers["x-auction-proxy-signature"] ?? "").trim();
  const timestampNumber = Number(timestamp);
  if (
    !secret || !ip || !timestamp || !signature || !Number.isFinite(timestampNumber) ||
    Math.abs(Date.now() - timestampNumber) > 5 * 60_000
  ) return null;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${ip}.${userAgent}`)
    .digest("hex");
  const left = Buffer.from(signature, "utf8");
  const right = Buffer.from(expected, "utf8");
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return { ip, userAgent };
}

function extractClientIp(req: Request): string {
  const verified = verifiedProxyIdentity(req);
  if (verified) return verified.ip;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? "unknown";
}

/** 모든 요청을 가로채 완료 시점에 로그 파일에 한 줄씩 기록한다(응답을 막지 않음). */
@Injectable()
export class RequestLogMiddleware implements NestMiddleware {
  constructor(private readonly writer: RequestLogWriterService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const start = Date.now();
    const proxyIdentity = verifiedProxyIdentity(req);
    const ip = extractClientIp(req);
    const cookieHeader = String(req.headers.cookie ?? "");
    const token = parseCookieValue(cookieHeader, AUTH_TOKEN_COOKIE);
    const username = token ? verifyAccessToken(token)?.sub ?? "" : "";

    res.on("finish", () => {
      void this.writer.append({
        ts: new Date().toISOString(),
        ip,
        method: req.method,
        path: req.path,
        username,
        status: res.statusCode,
        durationMs: Date.now() - start,
        userAgent: proxyIdentity?.userAgent ?? String(req.headers["user-agent"] ?? ""),
      });
    });

    next();
  }
}
