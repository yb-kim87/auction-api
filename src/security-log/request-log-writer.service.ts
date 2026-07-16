import { Injectable, Logger } from "@nestjs/common";
import { appendFile, mkdir, readFile, rename } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export interface RequestLogEntry {
  ts: string; // ISO 시각
  ip: string;
  method: string;
  path: string;
  username: string;
  status: number;
  durationMs: number;
  userAgent: string;
}

const LOG_DIR = join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "requests.log");
/** 이 크기를 넘으면 회전(rotate)해 무한히 커지는 것을 방지한다. */
const MAX_LOG_SIZE_BYTES = 20 * 1024 * 1024; // 20MB

/**
 * 모든 API 요청을 JSON Lines(한 줄에 요청 하나) 형태로 파일에 남긴다.
 * 이상행위 감지 스케줄러가 이 파일을 읽어 AI에게 판단을 맡긴다.
 */
@Injectable()
export class RequestLogWriterService {
  private readonly logger = new Logger(RequestLogWriterService.name);
  private ensured = false;

  private async ensureDir() {
    if (this.ensured) return;
    if (!existsSync(LOG_DIR)) await mkdir(LOG_DIR, { recursive: true });
    this.ensured = true;
  }

  async append(entry: RequestLogEntry): Promise<void> {
    try {
      await this.ensureDir();
      await this.rotateIfNeeded();
      await appendFile(LOG_FILE, JSON.stringify(entry) + "\n", "utf-8");
    } catch (err) {
      // 로깅 실패가 실제 요청 처리를 막으면 안 되므로 조용히 무시한다.
      this.logger.warn(
        `요청 로그 기록 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async rotateIfNeeded(): Promise<void> {
    if (!existsSync(LOG_FILE)) return;
    const stat = await import("fs/promises").then((m) => m.stat(LOG_FILE));
    if (stat.size < MAX_LOG_SIZE_BYTES) return;
    const rotated = join(LOG_DIR, `requests.${Date.now()}.log`);
    await rename(LOG_FILE, rotated);
  }

  /** 최근 로그 파일 내용을 그대로 읽는다(분석용). 없으면 빈 문자열. */
  async readAll(): Promise<string> {
    if (!existsSync(LOG_FILE)) return "";
    return readFile(LOG_FILE, "utf-8");
  }

  getLogFilePath(): string {
    return LOG_FILE;
  }
}
