import { CommandHandler, CommandContext, CommandRouter } from './index.js';

export function createHelpCommand(router: CommandRouter): CommandHandler {
  return {
    name: 'help',
    description: '显示所有可用命令',
    async handle(_ctx: CommandContext): Promise<string> {
      const pipalCommands = router.getCommands();

      if (pipalCommands.length === 0) {
        return '暂无可用命令';
      }

      const header = '| 命令 | 说明 |';
      const sep = '|------|------|';
      const rows = [header, sep];
      for (const c of pipalCommands) {
        const desc = c.description;
        rows.push(`| /${c.name} | ${desc} |`);
      }

      return ['**PiPal 内置命令**', '', ...rows].join('\n');
    },
  };
}
