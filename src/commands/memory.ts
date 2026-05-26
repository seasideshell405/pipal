import { CommandHandler, CommandContext } from './index.js';
import { PermanentMemory } from '../memory/permanent.js';

export function createMemoriesCommand(memory: PermanentMemory): CommandHandler {
  return {
    name: 'memories',
    description: '列出所有永久记忆',
    async handle(_ctx: CommandContext): Promise<string> {
      const entries = memory.list();
      if (entries.length === 0) return '暂无永久记忆。';
      const rows = [
        '**永久记忆**',
        '',
        '| # | 内容 | 日期 |',
        '|---|------|------|',
        ...entries.map(
          (e, i) =>
            `| ${i + 1} | ${e.content} | ${new Date(e.createdAt).toLocaleDateString('zh-CN')} |`,
        ),
      ];
      return rows.join('\n');
    },
  };
}
