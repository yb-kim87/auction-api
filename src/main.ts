import { config as loadEnv } from "dotenv";
import { join } from "path";
import { NestFactory } from "@nestjs/core";
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: buildCorsOrigins(),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  const openAiReady = Boolean(process.env.OPENAI_API_KEY?.trim());
  console.log(`Auction API running on http://localhost:${port}`);
  console.log(`경매코치 AI: ${openAiReady ? "사용 가능" : "설정 필요 (.env OPENAI_API_KEY)"}`);
}

bootstrap();
