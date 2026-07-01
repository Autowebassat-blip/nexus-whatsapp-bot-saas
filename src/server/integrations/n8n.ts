import type { BotMessageResult } from '../../shared/types';

export type N8nNotifierOptions = {
  webhookUrl?: string;
  webhookSecret?: string;
};

export type N8nMessageEvent = {
  companyId: string;
  phone: string;
  text: string;
  answer: string;
  source: BotMessageResult['source'];
  route: string[];
  cacheHit: boolean;
  geminiCalled: boolean;
  createdAt: string;
};

export class N8nNotifier {
  private readonly webhookUrl?: string;
  private readonly webhookSecret?: string;

  constructor(options: N8nNotifierOptions) {
    this.webhookUrl = options.webhookUrl;
    this.webhookSecret = options.webhookSecret;
  }

  async notifyMessage(event: N8nMessageEvent): Promise<void> {
    if (!this.webhookUrl) return;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (this.webhookSecret) headers['x-nexus-bot-secret'] = this.webhookSecret;

    const response = await fetch(this.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      throw new Error(`n8n_webhook_failed: ${response.status}`);
    }
  }
}
