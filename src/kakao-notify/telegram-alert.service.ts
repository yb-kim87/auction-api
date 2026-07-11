import { Injectable, Logger } from "@nestjs/common";

const TELEGRAM_API_BASE = "https://api.telegram.org";

/**
 * 알림톡 자동발송이 예상치 못하게 실패하거나 멈췄을 때 관리자에게
 * 텔레그램으로 즉시 알린다. 봇 토큰이 설정 안 돼 있으면 조용히 아무
 * 동작도 하지 않는다(운영 필수 기능이 아니라 보조 알림이므로).
 */
@Injectable()
export class TelegramAlertService {
  private readonly logger = new Logger(TelegramAlertService.name);

  private get botToken() {
    return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  }

  private get chatId() {
    return process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  }

  isConfigured(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  async send(message: string): Promise<void> {
    if (!this.isConfigured()) return;
    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${this.botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: this.chatId, text: message }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.error(`텔레그램 알림 전송 실패 (HTTP ${res.status}): ${body}`);
      }
    } catch (err) {
      this.logger.error(
        `텔레그램 알림 전송 오류: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
