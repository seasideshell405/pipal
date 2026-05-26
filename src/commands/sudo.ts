import { CommandHandler, CommandContext } from './index.js';
import { SessionManager } from '../pi-manager.js';

export function createSudoCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'sudo',
    description: '管理 sudo 开发模式会话',
    usage: '/sudo 或 /sudo new [标签] 或 /sudo <序号>',
    async handle(ctx: CommandContext): Promise<string> {
      if (sessionManager.isSudoMode) {
        return '已在 sudo 模式。发送 /exit 退出。';
      }

      const content = ctx.message.content.trim();
      const parts = content.split(/\s+/);

      // /sudo — 显示会话列表
      if (parts.length === 1) {
        const sessions = await sessionManager.listSudoSessions();
        if (sessions.length === 0) {
          return '没有 sudo 会话。发送 `/sudo new` 创建一个。';
        }

        const rows = sessions.map((s, i) => {
          const name = s.name ?? '(未命名)';
          const updated = s.updatedAt.slice(0, 16).replace('T', ' ');
          return `| ${i + 1} | ${name} | ${updated} |`;
        });

        return (
          '可用的 sudo 会话：\n\n' +
          '| # | 标签 | 上次使用 |\n' +
          '|---|------|----------|\n' +
          rows.join('\n') + '\n\n' +
          '`/sudo new <标签>` 创建新会话（可选标签）\n' +
          '`/sudo <序号>` 进入已有会话\n' +
          '`/exit` 退出当前 sudo 会话'
        );
      }

      const subCmd = parts[1];

      // /sudo new [标签]
      if (subCmd === 'new') {
        const label = parts.slice(2).join(' ');
        const err = await sessionManager.enterSudo(label || undefined);
        if (err) return err;
        if (label) {
          return `已进入 sudo 模式（${label}）。发送 /exit 退出。`;
        }
        return '已进入 sudo 模式。发送 /exit 退出。';
      }

      // /sudo <N>
      const index = parseInt(subCmd, 10);
      if (isNaN(index) || index < 1) {
        return '无效参数。使用 `/sudo` 查看列表，`/sudo new <标签>` 创建新会话。';
      }

      const err = await sessionManager.enterSudoByIndex(index);
      if (err) return err;
      return `已进入 sudo 会话 #${index}。发送 /exit 退出。`;
    },
  };
}

export function createExitCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'exit',
    description: '退出 sudo 开发模式，回到普通模式',
    async handle(_ctx: CommandContext): Promise<string> {
      if (!sessionManager.isSudoMode) {
        return '当前不在 sudo 模式。';
      }

      await sessionManager.exitSudo();
      return '已退出 sudo 模式，已恢复普通模式。';
    },
  };
}
