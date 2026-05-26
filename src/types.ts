// 统一消息格式
export interface Message {
  fromUserId: string;
  fromUserName: string;
  content: string;
  timestamp: Date;
  conversationId: string;
}

// LLM 提供商配置
export interface LLMConfig {
  provider: 'openai' | 'deepseek' | 'custom';
  apiKey: string;
  model: string;
  apiBase: string;
}

// 全部应用配置
export interface AppConfig {
  llm: LLMConfig;
  platform: {
    type: 'wechat';
    wechat: {
      botType: number;
      apiBase: string;
      botToken: string;
    };
  };
  cron: {
    dailySummary: string;
    sessionRotation: string;
    weeklySummary: string;
    backup: string;
  };
  dataDir: string;
}
