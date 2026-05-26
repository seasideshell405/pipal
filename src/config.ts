import { AppConfig } from './types.js';

const VALID_PROVIDERS = ['openai', 'deepseek', 'custom'] as const;

function envInt(key: string, fallback: number): number {
  const val = process.env[key];
  if (val === undefined) return fallback;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed)) {
    throw new Error(`环境变量 ${key} 的值 "${val}" 不是有效的整数`);
  }
  return parsed;
}

function validateProvider(provider: string): AppConfig['llm']['provider'] {
  if (VALID_PROVIDERS.includes(provider as AppConfig['llm']['provider'])) {
    return provider as AppConfig['llm']['provider'];
  }
  throw new Error(`不支持的 LLM provider: "${provider}"，可选值: ${VALID_PROVIDERS.join(', ')}`);
}

export function loadConfig(): AppConfig {
  const apiKey = process.env.LLM_API_KEY;
  if (!apiKey) {
    throw new Error('LLM_API_KEY 环境变量未设置');
  }

  const provider = validateProvider(process.env.LLM_PROVIDER ?? 'deepseek');

  return {
    llm: {
      provider,
      apiKey,
      model: process.env.LLM_MODEL ?? 'deepseek-v4-flash',
      apiBase: process.env.LLM_API_BASE ?? 'https://api.deepseek.com',
    },
    platform: {
      type: 'wechat',
      wechat: {
        botType: envInt('WECHAT_ILINK_BOT_TYPE', 3),
        apiBase: process.env.WECHAT_ILINK_API_BASE ?? 'https://ilinkai.weixin.qq.com',
        botToken: process.env.WECHAT_ILINK_BOT_TOKEN ?? '',
      },
    },
    cron: {
      dailySummary: process.env.CRON_DAILY_SUMMARY ?? '50 3 * * *',
      sessionRotation: process.env.CRON_SESSION_ROTATION ?? '10 4 * * *',
      weeklySummary: process.env.CRON_WEEKLY_SUMMARY ?? '55 3 * * 0',
      backup: process.env.CRON_BACKUP ?? '0 6 * * *',
    },
    dataDir: process.env.DATA_DIR ?? './data',
  };
}
