import { BotPlatform, Message } from './interface.js';
import { IlinkApiClient } from './ilink-api.js';
import type { Logger } from '../logger.js';

export interface TokenRefreshHandler {
  (botToken: string, ilinkUserId: string): Promise<void>;
}

const QR_POLL_INTERVAL_MS = 1000;
const QR_TIMEOUT_MS = 480_000;
const MAX_QR_REFRESH = 3;

export class WeChatIlinkAdapter implements BotPlatform {
  private polling = false;
  private getUpdatesBuf = '';
  private messageCallback: ((msg: Message) => void) | null = null;
  private loopPromise: Promise<void> | null = null;
  private ilinkUserId = '';
  private readonly contextTokens = new Map<string, string>();
  private readonly typingTickets = new Map<string, string>();
  private log: Logger;

  constructor(
    private readonly api: IlinkApiClient,
    private readonly initialToken: string,
    private readonly initialUserId: string,
    private readonly onTokenRefresh?: TokenRefreshHandler,
    logger?: Logger,
  ) {
    this.log = logger ?? { debug: console.log, info: console.log, warn: console.warn, error: console.error } as Logger;
    if (initialToken) {
      api.setToken(initialToken);
    }
  }

  onMessage(callback: (msg: Message) => void): () => void {
    this.messageCallback = callback;
    return () => {
      this.messageCallback = null;
    };
  }

  async start(): Promise<void> {
    await this.ensureLogin();
    this.polling = true;
    this.loopPromise = this.pollLoop();
  }

  async stop(): Promise<void> {
    this.polling = false;
    await this.loopPromise;
  }

  async sendMessage(conversationId: string, content: string): Promise<void> {
    await this.api.sendMessage(conversationId, content);
  }

  async sendTyping(conversationId: string): Promise<void> {
    if (!this.ilinkUserId) return;
    let ticket = this.typingTickets.get(conversationId);
    if (!ticket) {
      const ctxToken = this.contextTokens.get(conversationId);
      if (!ctxToken) return;
      const config = await this.api.getConfig(this.ilinkUserId, ctxToken);
      if (!config.typing_ticket) return;
      ticket = config.typing_ticket;
      this.typingTickets.set(conversationId, ticket);
    }
    await this.api.sendTyping(this.ilinkUserId, ticket);
  }

  private async ensureLogin(): Promise<void> {
    // 已有 token（从 .env 加载），跳过扫码
    if (this.initialToken) {
      this.ilinkUserId = this.initialUserId;
      this.log.info('已恢复登录凭证');
      return;
    }

    const qrResp = await this.api.getQrCode();
    this.log.info('请扫码登录: ' + qrResp.qrcode_img_content);

    let qrRefreshCount = 0;
    let qrcode = qrResp.qrcode;
    const deadline = Date.now() + QR_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const statusResp = await this.api.getQRCodeStatus(qrcode);

      switch (statusResp.status) {
        case 'wait':
          if (qrRefreshCount === 0) this.log.info('等待扫码...');
          break;

        case 'scaned':
          this.log.info('已扫码，请在微信确认登录');
          break;

        case 'scaned_but_redirect':
          if (statusResp.redirect_host) {
            const newBase = `https://${statusResp.redirect_host}`;
            this.log.info('重定向到: ' + newBase);
            this.api.setBaseUrl(newBase);
          }
          break;

        case 'confirmed': {
          if (!statusResp.bot_token || !statusResp.ilink_bot_id) {
            throw new Error('扫码确认后未返回 token');
          }
          this.api.setToken(statusResp.bot_token);
          this.ilinkUserId = statusResp.ilink_user_id ?? '';
          if (statusResp.baseurl) this.api.setBaseUrl(statusResp.baseurl);
          await this.onTokenRefresh?.(
            statusResp.bot_token,
            statusResp.ilink_user_id ?? '',
          );
          this.log.info('登录成功!');
          return;
        }

        case 'expired': {
          qrRefreshCount++;
          if (qrRefreshCount > MAX_QR_REFRESH) {
            throw new Error('二维码多次过期，登录超时');
          }
          this.log.info(`二维码已过期，刷新第 ${qrRefreshCount} 次...`);
          const newQr = await this.api.getQrCode();
          qrcode = newQr.qrcode;
          this.log.info('新二维码: ' + newQr.qrcode_img_content);
          break;
        }

        default:
          break;
      }

      await new Promise((r) => setTimeout(r, QR_POLL_INTERVAL_MS));
    }

    throw new Error('登录超时');
  }

  private async pollLoop(): Promise<void> {
    while (this.polling) {
      try {
        const result = await this.api.getUpdates(this.getUpdatesBuf);
        this.getUpdatesBuf = result.getUpdatesBuf;

        for (const imsg of result.messages) {
          this.contextTokens.set(imsg.fromUserId, imsg.contextToken ?? '');
          const msg: Message = {
            fromUserId: imsg.fromUserId,
            fromUserName: '',
            content: imsg.content,
            timestamp: new Date(),
            conversationId: imsg.fromUserId,
            contextToken: imsg.contextToken,
          };
          try {
            this.messageCallback?.(msg);
          } catch (cbErr) {
            this.log.error('消息回调处理失败: ' + String(cbErr));
          }
        }

        if (result.messages.length === 0) {
          await new Promise((r) => setTimeout(r, 50));
        }
      } catch (err) {
        const msg = String(err);
        if (msg.includes('errcode=-14')) {
          this.log.error('会话过期，停止轮询');
          this.polling = false;
          return;
        }
        this.log.error('轮询消息失败: ' + msg);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }
}
