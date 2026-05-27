import { CommandHandler, CommandContext } from './index.js';
import { SessionManager } from '../pi-manager.js';

export function createReloadCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'reload',
    description: '重新加载 Pi 扩展、技能和提示词（新扩展即时生效）',
    usage: '/reload',
    async handle(_ctx: CommandContext): Promise<string> {
      const err = await sessionManager.reload();
      if (err) return err;
      return '已重新加载扩展和技能，新扩展已生效。';
    },
  };
}
