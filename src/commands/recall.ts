import { CommandHandler, CommandContext } from './index.js';
import { SessionManager } from '../pi-manager.js';

export function createRecallCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'recall',
    description: '撤回最近的对话',
    async handle(ctx: CommandContext): Promise<string> {
      if (sessionManager.isSudoMode) {
        return '开发者模式中不支持删除，请先发送 /exit 退出。';
      }

      const deletedUser = await sessionManager.deleteLastExchange();
      if (deletedUser === null) {
        return '没有可删除的对话。至少要保留一轮对话。';
      }

      return '已撤回最近一轮对话。';
    },
  };
}
