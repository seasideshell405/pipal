import { CommandHandler, CommandContext } from './index.js';

let restarting = false;

export function createRestartCommand(): CommandHandler {
  return {
    name: 'restart',
    description: '重启 PiPal 应用',
    async handle(_ctx: CommandContext): Promise<string> {
      if (restarting) {
        return '正在重启中，请稍候...';
      }
      restarting = true;
      setTimeout(() => {
        process.exit(0);
      }, 500);
      return '正在重启...';
    },
  };
}
