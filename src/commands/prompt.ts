import { CommandHandler, CommandContext } from './index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface PromptSource {
  getSystemPrompt(): string;
  getTools(): Array<{ name: string; description: string }>;
  getActiveToolNames(): string[];
}

function formatTs(): string {
  const d = new Date();
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D}_${h}${m}${s}`;
}

export function createPromptCommand(source: PromptSource, dataDir: string): CommandHandler {
  return {
    name: 'prompt',
    description: '查看 Pi 系统提示词',
    async handle(_ctx: CommandContext): Promise<string> {
      const prompt = source.getSystemPrompt();
      if (!prompt) return '当前没有活跃的 Pi 会话，系统提示词尚未生成。';

      const parts: string[] = ['**Pi 系统提示词**', '', '```', prompt, '```'];

      const activeNames = new Set(source.getActiveToolNames());
      const tools = source.getTools().filter((t) => activeNames.has(t.name));
      if (tools.length > 0) {
        const header = '| 工具 | 说明 |';
        const sep = '|------|------|';
        const rows = tools.map((t) => `| ${t.name} | ${t.description} |`);
        parts.push('', '**可用工具**', '', header, sep, ...rows);
      }

      const outDir = join(dataDir, 'tmp', 'sysprompt');
      mkdirSync(outDir, { recursive: true });
      const filename = `${formatTs()}.md`;
      const filepath = join(outDir, filename);
      writeFileSync(filepath, parts.join('\n'), 'utf-8');

      return `系统提示词已保存到 \`${filepath}\``;
    },
  };
}
