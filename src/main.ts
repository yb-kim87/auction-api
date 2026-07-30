import { config as loadEnv } from "dotenv";
import { join } from "path";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import express from "express";
import { AppModule } from "./app.module";

loadEnv({ path: join(__dirname, "..", ".env") });

function buildCorsOrigins(): string[] {
  const defaults = ["http://localhost:3000", "http://127.0.0.1:3000"];
  const fromEnv = (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
}

/** 랜딩페이지(/public/* 공개 API)를 호출할 수 있는 외부 도메인 화이트리스트. */
function buildPublicApiOrigins(): string[] {
  const defaults = ["https://auctioncoachp.imweb.me"];
  const fromEnv = (process.env.PUBLIC_API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...defaults, ...fromEnv])];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // /public/* 경로(랜딩페이지에서 인증 없이 호출하는 공개 API)는 아임웹 랜딩
  // 도메인만 허용하고, 그 외 전체 API는 화이트리스트+쿠키 인증을 유지한다.
  // Nest의 enableCors는 경로별 분기를 지원하지 않으므로 미들웨어를 먼저
  // 등록해 공개 경로의 CORS 헤더를 직접 세팅하고 짧게 응답을 마친다.
  const publicApiOrigins = buildPublicApiOrigins();
  app.use((req: { path: string; method: string; headers: Record<string, string | undefined> }, res: { header: (k: string, v: string) => void; sendStatus: (c: number) => void }, next: () => void) => {
    if (req.path.startsWith("/public/")) {
      const origin = req.headers.origin;
      if (origin && publicApiOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
      }
      res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  app.enableCors({
    origin: buildCorsOrigins(),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  });

  app.use(cookieParser());

  // Express 기본 JSON body 한도(100kb)로는 크롤러가 보내는 물건 상세
  // payload(사진 목록·파일정보 등 extraData 포함 시)가 종종 초과돼 413으로
  // 거부됐다(예: "2023타경6551" 저장 실패, 2026-07-19). 여유 있게 늘린다.
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ limit: "20mb", extended: true }));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  const openAiReady = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log(`Auction API running on http://localhost:${port}`);
  console.log(`코치픽 AI: ${openAiReady ? "사용 가능" : "설정 필요 (.env OPENAI_API_KEY)"}`);
}

bootstrap();
