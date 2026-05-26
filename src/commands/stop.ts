import { CommandHandler, CommandContext } from './index.js';
import { SessionManager } from '../pi-manager.js';

export function createStopCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'stop',
    description: '打断当前 Pi 的执行',
    async handle(_ctx: CommandContext): Promise<string> {
      if (!sessionManager.isProcessing) {
        return 'Pi 当前没有在执行任何操作。';
      }
      await sessionManager.stop();
      return '已打断 Pi 的执行。';
    },
  };
}
