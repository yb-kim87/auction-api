import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { RequestLog } from "./request-log.entity";

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

/** 오래된 로그를 이 기간이 지나면 자동 삭제한다 — 문제 조사에 필요한
 * 기간은 확보하면서도 테이블이 무한정 커져 조회가 느려지는 것을
 * 막는다(사용자 요청, 2026-07-22). */
const RETENTION_DAYS = 30;

/**
 * 모든 API 요청을 DB(request_logs)에 남긴다. 이전에는 파일(JSON Lines)에
 * 기록했으나 Railway 재배포 시 컨테이너 파일시스템이 초기화되어 로그가
 * 사라지는 문제가 있었다(사용자 요청으로 DB 테이블 방식으로 전환,
 * 2026-07-22). 이상행위 감지 스케줄러가 이 테이블을 읽어 AI에게 판단을
 * 맡긴다.
 */
@Injectable()
export class RequestLogWriterService {
  private readonly logger = new Logger(RequestLogWriterService.name);

  constructor(
    @InjectRepository(RequestLog)
    private readonly repo: Repository<RequestLog>,
  ) {}

  async append(entry: RequestLogEntry): Promise<void> {
    try {
      await this.repo.insert({
        ts: new Date(entry.ts),
        ip: entry.ip,
        method: entry.method,
        path: entry.path,
        username: entry.username,
        status: entry.status,
        durationMs: entry.durationMs,
        userAgent: entry.userAgent,
      });
    } catch (err) {
      // 로깅 실패가 실제 요청 처리를 막으면 안 되므로 조용히 무시한다.
      this.logger.warn(
        `요청 로그 기록 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 지정 시각(since) 이후의 로그를 시각순으로 반환(분석용). */
  async findSince(since: Date): Promise<RequestLogEntry[]> {
    const found = await this.repo
      .createQueryBuilder("r")
      .where("r.ts >= :since", { since })
      .orderBy("r.ts", "ASC")
      .getMany();
    return found.map((r) => ({
      ts: r.ts.toISOString(),
      ip: r.ip,
      method: r.method,
      path: r.path,
      username: r.username,
      status: r.status,
      durationMs: r.durationMs,
      userAgent: r.userAgent,
    }));
  }

  /** 최근 로그 N건(최신순)을 관리자 화면 조회용으로 반환. */
  async findRecent(limit: number): Promise<RequestLogEntry[]> {
    const rows = await this.repo.find({
      order: { ts: "DESC" },
      take: limit,
    });
    return rows
      .map((r) => ({
        ts: r.ts.toISOString(),
        ip: r.ip,
        method: r.method,
        path: r.path,
        username: r.username,
        status: r.status,
        durationMs: r.durationMs,
        userAgent: r.userAgent,
      }))
      .reverse();
  }

  /** 보관 기간(RETENTION_DAYS)이 지난 로그를 삭제한다. */
  async purgeOld(): Promise<number> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.repo.delete({ ts: LessThan(cutoff) });
    return result.affected ?? 0;
  }
}
