import { CommandHandler, CommandContext } from './index.js';
import { SessionManager } from '../pi-manager.js';

export function createRollbackCommand(sessionManager: SessionManager): CommandHandler {
  return {
    name: 'rollback',
    description: '带总结的回退对话内容',
    async handle(ctx: CommandContext): Promise<string> {
      if (sessionManager.isSudoMode) {
        return '开发模式中不支持回滚，请先发送 /exit 退出。';
      }

      const content = ctx.message.content.trim();
      const parts = content.split(/\s+/);

      // 不带参数：列出所有可回滚节点（最新在前）
      if (parts.length === 1) {
        const points = sessionManager.getForkPoints().slice(-60);
        if (points.length === 0) return '没有可回滚的对话节点。';
        if (points.length === 1) {
          return '只有一个对话节点（当前对话），无需回滚。';
        }

        const reversed = [...points].reverse();
        const rows = reversed.map((p, i) => {
          const text = p.content ?? '';
          const preview = text.replace(/\n/g, ' ').slice(0, 40);
          return `| ${i + 1} | ${preview}${text.length > 40 ? '…' : ''} |`;
        });
        const list = ['| 序号 | 消息预览 |', '|------|----------|', ...rows].join('\n');

        return (
          `可回滚的对话节点（最新在前，共 ${points.length} 个）：\n\n${list}\n\n` +
          `/rollback <序号> 将总结序号 1~M 的对话，从序号 M+1 位置继续对话。`
        );
      }

      // 带序号：执行回滚（N = 向后回退 N 步，即总结序号 1~N，从序号 N+1 继续）
      const steps = parseInt(parts[1], 10);
      const points = sessionManager.getForkPoints().slice(-60);
      if (isNaN(steps) || steps < 1 || steps >= points.length) {
        return `步数无效，请输入 1-${points.length - 1} 之间的数字。`;
      }

      const originalIndex = points.length - 1 - steps;
      await sessionManager.rollbackTo(points[originalIndex].entryId);
      return `已回滚到节点 ${parts[1]}，其后的对话已总结并折叠。可以继续对话了。`;
    },
  };
}
