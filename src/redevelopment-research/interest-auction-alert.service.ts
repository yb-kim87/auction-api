import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { LessThanOrEqual, Repository } from "typeorm";
import { Auction } from "../auctions/auction.entity";
import { isClosedCaseState } from "../auctions/crawl-item-validation.util";
import { TelegramAlertService } from "../kakao-notify/telegram-alert.service";
import { RedevelopmentPoint, RedevelopmentZone } from "../redevelopment/entities/redevelopment-zone.entity";
import { InterestAuctionAlert } from "./entities/interest-auction-alert.entity";
import { KakaoGeocodeService } from "./kakao-geocode.service";

export function pointInInterestZone(point: RedevelopmentPoint, polygon: RedevelopmentPoint[]): boolean {
  if (!Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.lat > point.lat) !== (b.lat > point.lat) && point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng) inside = !inside;
  }
  return inside;
}

@Injectable()
export class InterestAuctionAlertService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InterestAuctionAlertService.name);
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  constructor(
    @InjectRepository(InterestAuctionAlert) private readonly queue: Repository<InterestAuctionAlert>,
    @InjectRepository(Auction) private readonly auctions: Repository<Auction>,
    @InjectRepository(RedevelopmentZone) private readonly zones: Repository<RedevelopmentZone>,
    private readonly geocoder: KakaoGeocodeService,
    private readonly telegram: TelegramAlertService,
  ) {}

  private get destination(): string { return process.env.REDEVELOPMENT_TELEGRAM_CHAT_ID?.trim() ?? ""; }
  onModuleInit() { this.timer = setInterval(() => void this.process().catch((e) => this.logger.error(`관심 구역 알림 처리 실패: ${e}`)), 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** 알림을 켠 이후 크롤러가 새로 등록한 물건만 큐에 넣는다. */
  async enqueue(auction: Auction): Promise<void> {
    if (!this.destination || !process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
    await this.queue.createQueryBuilder().insert().values({ auctionId: auction.id, status: "pending", attempts: 0, nextAttemptAt: new Date(), createdAt: new Date(), sentAt: null, lastError: null }).orIgnore().execute();
  }

  async process(): Promise<void> {
    if (this.busy || !this.destination || !process.env.TELEGRAM_BOT_TOKEN?.trim()) return;
    this.busy = true;
    try {
      const pending = await this.queue.find({ where: { status: "pending", nextAttemptAt: LessThanOrEqual(new Date()) }, order: { createdAt: "ASC" }, take: 30 });
      for (const entry of pending) {
        const leaseUntil = new Date(Date.now() + 5 * 60_000);
        const claim = await this.queue.createQueryBuilder().update().set({ nextAttemptAt: leaseUntil }).where('"auctionId" = :id AND "status" = :status AND "nextAttemptAt" <= :now', { id: entry.auctionId, status: "pending", now: new Date() }).execute();
        if (!claim.affected) continue;
        try { await this.processOne(entry); }
        catch (e) { await this.retry(entry, e instanceof Error ? e.message : String(e)); }
      }
    } finally { this.busy = false; }
  }

  private async retry(entry: InterestAuctionAlert, reason: string): Promise<void> {
    await this.queue.update(entry.auctionId, { attempts: entry.attempts + 1, nextAttemptAt: new Date(Date.now() + 10 * 60_000), lastError: reason.slice(0, 500) });
    this.logger.warn(`관심 구역 알림 재시도 대기(${entry.auctionId}): ${reason}`);
  }

  private async processOne(entry: InterestAuctionAlert): Promise<void> {
    const item = await this.auctions.findOne({ where: { id: entry.auctionId } });
    if (!item || (item.salePrice ?? 0) > 0 || isClosedCaseState(item.caseState)) {
      await this.queue.update(entry.auctionId, { status: "skipped", lastError: "물건 없음 또는 종결" }); return;
    }
    const zones = await this.zones.find({ where: { isInterest: true } });
    if (!zones.length) { await this.queue.update(entry.auctionId, { status: "skipped", lastError: "관심 구역 없음" }); return; }
    let lat = item.latitude, lng = item.longitude;
    if (lat == null || lng == null) {
      const geo = await this.geocoder.geocode(item.address);
      if (!geo) { await this.retry(entry, "좌표 확인 실패"); return; }
      lat = geo.lat; lng = geo.lng;
    }
    const matches = zones.filter((zone) => pointInInterestZone({ lat: Number(lat), lng: Number(lng) }, zone.polygon));
    if (!matches.length) { await this.queue.update(entry.auctionId, { status: "skipped", lastError: "관심 구역 경계 밖" }); return; }
    const money = (amount: number | null | undefined) => amount && amount > 0 ? `${Math.round(amount).toLocaleString("ko-KR")}원` : "미확인";
    const text = ["📍 관심 구역 신규 경매물건", `구역: ${matches.map((z) => z.name).join(", ")}`, `사건번호: ${item.auctionNo}`, `법원: ${item.court || "미확인"}`, `주소: ${item.address}`, `감정가: ${money(item.appraisedValue)}`, `최저가: ${money(item.minPrice)}`, `입찰일: ${item.bidDate || "미확인"}`, item.link ? `원문: ${item.link}` : ""].filter(Boolean).join("\n");
    if (!(await this.telegram.send(text, this.destination))) { await this.retry(entry, "텔레그램 전송 실패"); return; }
    await this.queue.update(entry.auctionId, { status: "sent", sentAt: new Date(), lastError: null });
    this.logger.log(`관심 구역 신규 경매 알림 발송: ${item.auctionNo}`);
  }
}
