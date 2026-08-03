import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThan, Repository } from "typeorm";
import { AuctionChangeLog } from "../auctions/auction-change.entity";
import { CrawlerLogRow } from "../crawler/crawler-log.entity";
import { KakaoDispatchLog } from "../kakao-notify/kakao-dispatch-log.entity";
import { ActualTradeRow } from "../resale-match/entities/actual-trade.entity";
import { UserItemAction } from "../user-actions/user-item-action.entity";

/** 로그성 테이블(변경 이력·발송 로그·크롤러 로그·행동 로그) 공통 보관 기간.
 * 문제 조사에 필요한 기간은 확보하면서도 테이블이 무한정 커지는 걸 막는다
 * (request_logs가 이미 30일로 운영 중인 것과 같은 이유, RequestLogWriterService
 * 참고). DB 용량 진단 요청(2026-08-02) 결과 크롤링 프로젝트 특성상 이런
 * 로그성 테이블이 가장 빠르게 쌓인다는 점을 확인해 도입. */
const LOG_RETENTION_DAYS = 90;

/** actual_trade(국토부 실거래가)는 매도분석 매칭에 쓰이므로 로그가 아니지만,
 * 계약일이 오래된 실거래는 더 이상 최근 낙찰물건과 매칭될 일이 없어
 * 3년(36개월)이 지나면 정리한다(사용자 승인, 2026-08-02 "그렇게 하자"). */
const ACTUAL_TRADE_RETENTION_MONTHS = 36;

/** 정리 주기 — request_logs의 PURGE_INTERVAL_MINUTES(60분)과 달리 매일
 * 한 번이면 충분한 대용량 정리라 더 긴 간격으로 돈다. */
const PURGE_INTERVAL_MINUTES = 6 * 60;

/**
 * DB 용량 진단(2026-08-02, 7개 항목 요청) 결과에 따라 도입한 보관기간
 * 정리 스케줄러. actual_trade(36개월 초과 실거래)와 로그성 테이블
 * 4종(auction_change_logs/kakao_dispatch_logs/user_item_actions/
 * crawler_log, 90일 초과)을 주기적으로 정리한다. request_logs는 이미
 * RequestLogWriterService.purgeOld()가 별도로 30일 보관을 처리하므로
 * 여기서는 다루지 않는다.
 */
@Injectable()
export class DbRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbRetentionService.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @InjectRepository(ActualTradeRow)
    private readonly actualTradeRepo: Repository<ActualTradeRow>,
    @InjectRepository(AuctionChangeLog)
    private readonly auctionChangeLogRepo: Repository<AuctionChangeLog>,
    @InjectRepository(KakaoDispatchLog)
    private readonly kakaoDispatchLogRepo: Repository<KakaoDispatchLog>,
    @InjectRepository(UserItemAction)
    private readonly userItemActionRepo: Repository<UserItemAction>,
    @InjectRepository(CrawlerLogRow)
    private readonly crawlerLogRepo: Repository<CrawlerLogRow>,
  ) {}

  onModuleInit() {
    void this.purgeAll().catch(() => {});
    this.timer = setInterval(
      () => void this.purgeAll().catch(() => {}),
      PURGE_INTERVAL_MINUTES * 60_000,
    );
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async purgeAll(): Promise<Record<string, number>> {
    const logCutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const tradeCutoff = new Date();
    tradeCutoff.setMonth(tradeCutoff.getMonth() - ACTUAL_TRADE_RETENTION_MONTHS);
    const tradeCutoffStr = tradeCutoff.toISOString().slice(0, 10);

    const result: Record<string, number> = {};

    result.actual_trade = await this.safeDelete("actual_trade", () =>
      this.actualTradeRepo.delete({ contractDate: LessThan(tradeCutoffStr) }),
    );
    result.auction_change_logs = await this.safeDelete("auction_change_logs", () =>
      this.auctionChangeLogRepo.delete({ changedAt: LessThan(logCutoff) }),
    );
    result.kakao_dispatch_logs = await this.safeDelete("kakao_dispatch_logs", () =>
      this.kakaoDispatchLogRepo.delete({ sentAt: LessThan(logCutoff) }),
    );
    result.user_item_actions = await this.safeDelete("user_item_actions", () =>
      this.userItemActionRepo.delete({ createdAt: LessThan(logCutoff) }),
    );
    result.crawler_log = await this.safeDelete("crawler_log", () =>
      this.crawlerLogRepo.delete({ at: LessThan(logCutoff) }),
    );

    const total = Object.values(result).reduce((a, b) => a + b, 0);
    if (total > 0) {
      this.logger.log(
        `DB 보관기간 정리 완료: ${Object.entries(result)
          .map(([table, count]) => `${table} ${count}건`)
          .join(", ")}`,
      );
    }
    return result;
  }

  private async safeDelete(
    table: string,
    run: () => Promise<{ affected?: number | null }>,
  ): Promise<number> {
    try {
      const res = await run();
      return res.affected ?? 0;
    } catch (err) {
      this.logger.error(
        `${table} 정리 실패: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }
}
