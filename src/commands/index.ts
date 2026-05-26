import { Message } from '../platform/interface.js';

export interface CommandContext {
  readonly message: Message;
  readonly sendReply: (content: string) => Promise<void>;
  readonly sendTyping: () => Promise<void>;
}

export interface CommandHandler {
  readonly name: string;
  readonly description: string;
  readonly usage?: string;
  handle(ctx: CommandContext): Promise<string>;
}

export class CommandRouter {
  private handlers: CommandHandler[] = [];

  register(handler: CommandHandler): void {
    this.handlers.push(handler);
  }

  async handle(ctx: CommandContext): Promise<boolean> {
    const content = ctx.message.content;
    if (!content.startsWith('/')) return false;

    const cmd = content.slice(1).split(/\s+/)[0];
    const handler = this.handlers.find(
      (h) => h.name.toLowerCase() === cmd.toLowerCase()
    );
    if (!handler) {
      console.error(`[COMMAND] 未匹配命令 "${cmd}"，已注册: [${this.handlers.map(h => h.name).join(', ')}]`);
      return false;
    }

    const response = await handler.handle(ctx);
    await ctx.sendReply(response);
    return true;
  }

  getCommands(): CommandHandler[] {
    return [...this.handlers];
  }
}
