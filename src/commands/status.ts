import { CommandHandler, CommandContext } from './index.js';
import type { SessionManager } from '../pi-manager.js';

export interface BotStats {
  totalMessages: number;
  startTime: Date;
}

export function createStatusCommand(stats: BotStats, sessionManager: SessionManager): CommandHandler {
  return {
    name: 'status',
    description: '显示会话状态',
    async handle(_ctx: CommandContext): Promise<string> {
      const uptimeMs = Date.now() - stats.startTime.getTime();
      const hours = Math.floor(uptimeMs / 3600000);
      const minutes = Math.floor((uptimeMs % 3600000) / 60000);
      const estimated = sessionManager.getEstimatedInputTokens();
      const msgCount = sessionManager.getPathMessageCount();
      return [
        '**PiPal 状态**',
        '',
        '| 项目 | 值 |',
        '|------|-----|',
        `| 启动时间 | ${stats.startTime.toLocaleString('zh-CN')} |`,
        `| 运行时长 | ${hours}小时${minutes}分钟 |`,
        `| 今日对话 | ${msgCount} 轮 |`,
        `| 上次请求 | ${estimated.toLocaleString('zh-CN')} tokens |`,
      ].join('\n');
    },
  };
}
