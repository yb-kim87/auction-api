import { Injectable, Logger } from "@nestjs/common";
import type { UpdateAuctionDto } from "../auctions/update-auction.dto";
import type { CrawlerAlgorithmConfig } from "./crawler.types";

@Injectable()
export class CrawlerTelegramService {
  private readonly logger = new Logger(CrawlerTelegramService.name);

  async send(message: string): Promise<boolean> {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) {
      this.logger.warn("텔레그램 환경변수가 설정되지 않았습니다.");
      return false;
    }

    try {
      const url = `https://api.telegram.org/bot${token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
      if (!res.ok) {
        const body = await res.text();
        this.logger.warn(`텔레그램 전송 실패: ${body}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `텔레그램 전송 오류: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}

export function checkAlgorithmMatch(
  item: Partial<UpdateAuctionDto>,
  config: CrawlerAlgorithmConfig,
): boolean {
  if (!config.enabled || item.usage !== "아파트") {
    return false;
  }

  try {
    let ok = true;

    if (config.minArea > 0) {
      const area = parseFloat(String(item.area ?? "0").replace(/[^\d.]/g, ""));
      ok &&= Number.isFinite(area) && area >= config.minArea;
    }

    if (config.minHouseholds > 0) {
      ok &&= Number(item.totalUnits ?? 0) >= config.minHouseholds;
    }

    if (config.minGapPriceMan > 0) {
      const gapWon = Number(item.diffNaverMin ?? 0);
      ok &&= gapWon > config.minGapPriceMan * 10_000;
    }

    if (config.registryKeyword.trim()) {
      ok &&= String(item.buildingRegistry ?? "").includes(
        config.registryKeyword.trim(),
      );
    }

    return ok;
  } catch {
    return false;
  }
}

export function buildAlgorithmTelegramMessage(
  item: Partial<UpdateAuctionDto>,
): string {
  return [
    item.usage ?? "물건",
    item.auctionNo ?? "",
    item.address ?? "",
    item.link ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}
