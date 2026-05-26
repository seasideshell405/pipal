import { CommandHandler, CommandContext } from './index.js';

interface PromptSource {
  getSystemPrompt(): string;
  getTools(): Array<{ name: string; description: string }>;
  getActiveToolNames(): string[];
}

export function createPromptCommand(source: PromptSource): CommandHandler {
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

      return parts.join('\n');
    },
  };
}
