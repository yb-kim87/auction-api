import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { RequestLogWriterService } from "./request-log-writer.service";
import { AUTH_TOKEN_COOKIE, parseCookieValue, verifyAccessToken } from "../auth/jwt.util";

function extractClientIp(req: Request): string {
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
        userAgent: String(req.headers["user-agent"] ?? ""),
      });
    });

    next();
  }
}
