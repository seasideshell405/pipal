import crypto from 'node:crypto';

export interface QRCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
}

export interface QRStatusResponse {
  status: string;
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
  redirect_host?: string;
}

export interface IlinkMessage {
  fromUserId: string;
  content: string;
  contextToken?: string;
}

export interface GetUpdatesResult {
  messages: IlinkMessage[];
  getUpdatesBuf: string;
}

export interface GetConfigResp {
  typing_ticket?: string;
}

export interface IlinkApiClient {
  getQrCode(): Promise<QRCodeResponse>;
  getQRCodeStatus(qrcode: string): Promise<QRStatusResponse>;
  getUpdates(getUpdatesBuf: string): Promise<GetUpdatesResult>;
  getConfig(ilinkUserId: string, contextToken: string): Promise<GetConfigResp>;
  sendMessage(toUserId: string, content: string): Promise<void>;
  sendTyping(ilinkUserId: string, typingTicket: string): Promise<void>;
  setToken(token: string): void;
  setBaseUrl(url: string): void;
}

function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function buildCommonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'iLink-App-Id': '',
    'X-WECHAT-UIN': randomWechatUin(),
  };
}

function buildAuthHeaders(token: string): Record<string, string> {
  const headers = buildCommonHeaders();
  headers['AuthorizationType'] = 'ilink_bot_token';
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function extractTextBody(
  itemList?: Array<{ type?: number; text_item?: { text?: string } }>,
): string {
  if (!itemList?.length) return '';
  for (const item of itemList) {
    if (item.type === 1 && item.text_item?.text != null) {
      return item.text_item.text;
    }
  }
  return '';
}

function checkApiError(json: Record<string, unknown>, rawText: string): void {
  const errcode = json.errcode;
  if (errcode !== undefined && errcode !== 0) {
    throw new Error((json.errmsg as string) ?? `API errcode=${errcode}`);
  }
  const ret = json.ret;
  if (ret !== undefined && ret !== 0) {
    throw new Error((json.err_msg as string) ?? `API ret=${ret}`);
  }
}

export function createApiClient(
  apiBase: string,
  initialToken = '',
  botType = 3,
): IlinkApiClient {
  let botToken = initialToken;
  let baseUrl = apiBase.replace(/\/+$/, '');

  async function getRequest<T>(
    endpoint: string,
    timeoutMs = 30000,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/${endpoint}`, {
        method: 'GET',
        headers: buildCommonHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
      }
      const json = JSON.parse(rawText) as Record<string, unknown>;
      checkApiError(json, rawText);
      return json as T;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  async function postRequest<T>(
    endpoint: string,
    body: unknown,
    timeoutMs = 15000,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/${endpoint}`, {
        method: 'POST',
        headers: buildAuthHeaders(botToken),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 200)}`);
      }
      return JSON.parse(rawText) as T;
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  const client: IlinkApiClient = {
    setToken(token: string) {
      botToken = token;
    },
    setBaseUrl(url: string) {
      baseUrl = url.replace(/\/+$/, '');
    },

    async getQrCode(): Promise<QRCodeResponse> {
      return getRequest<QRCodeResponse>(
        `ilink/bot/get_bot_qrcode?bot_type=${botType}`,
      );
    },

    async getQRCodeStatus(qrcode: string): Promise<QRStatusResponse> {
      return getRequest<QRStatusResponse>(
        `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
        35000,
      );
    },

    async getUpdates(getUpdatesBuf: string): Promise<GetUpdatesResult> {
      let resp: Record<string, unknown>;
      try {
        resp = await postRequest<Record<string, unknown>>(
          'ilink/bot/getupdates',
          {
            get_updates_buf: getUpdatesBuf ?? '',
            base_info: { channel_version: '1.0.0' },
          },
          35000,
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { messages: [], getUpdatesBuf };
        }
        throw err;
      }

      checkApiError(resp, JSON.stringify(resp));

      const msgs = (resp.msgs as Array<Record<string, unknown>>) ?? [];
      const messages: IlinkMessage[] = [];
      for (const m of msgs) {
        // 忽略自己发出的消息（message_type=2 表示 bot 消息）
        if (m.message_type === 2) continue;
        const fromUserId = m.from_user_id as string | undefined;
        if (!fromUserId) continue;
        messages.push({
          fromUserId,
          content: extractTextBody(
            m.item_list as
              | Array<{ type?: number; text_item?: { text?: string } }>
              | undefined,
          ),
          contextToken: (m.context_token as string) ?? undefined,
        });
      }

      return {
        messages,
        getUpdatesBuf: (resp.get_updates_buf as string) ?? getUpdatesBuf,
      };
    },

    async getConfig(ilinkUserId: string, contextToken: string): Promise<GetConfigResp> {
      return postRequest<GetConfigResp & Record<string, unknown>>(
        'ilink/bot/getconfig',
        {
          ilink_user_id: ilinkUserId,
          context_token: contextToken,
          base_info: { channel_version: '1.0.0' },
        },
        10000,
      );
    },

    async sendMessage(toUserId: string, content: string): Promise<void> {
      await postRequest('ilink/bot/sendmessage', {
        msg: {
          from_user_id: '',
          to_user_id: toUserId,
          client_id: `pipal-${crypto.randomUUID().slice(0, 8)}`,
          message_type: 2,
          message_state: 2,
          item_list: [{ type: 1, text_item: { text: content } }],
        },
        base_info: { channel_version: '1.0.0' },
      });
    },

    async sendTyping(
      ilinkUserId: string,
      typingTicket: string,
    ): Promise<void> {
      await postRequest('ilink/bot/sendtyping', {
        ilink_user_id: ilinkUserId,
        typing_ticket: typingTicket,
        status: 1,
        base_info: { channel_version: '1.0.0' },
      });
    },
  };

  return client;
}
