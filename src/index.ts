import 'dotenv/config';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { ensureSetup, writeEnvVar } from './setup.js';
import { loadConfig } from './config.js';
import { createApiClient } from './platform/ilink-api.js';
import { WeChatIlinkAdapter } from './platform/wechat-ilink.js';
import { Message } from './platform/interface.js';
import { CommandRouter, CommandContext } from './commands/index.js';
import { createHelpCommand } from './commands/help.js';
import { createStatusCommand, BotStats } from './commands/status.js';
import { createMemoriesCommand } from './commands/memory.js';
import { createPromptCommand } from './commands/prompt.js';
import { createStopCommand } from './commands/stop.js';
import { createSudoCommand, createExitCommand } from './commands/sudo.js';
import { createRollbackCommand } from './commands/rollback.js';
import { createRecallCommand } from './commands/recall.js';
import { PermanentMemory } from './memory/permanent.js';
import { createArchive } from './memory/archival.js';
import { SessionManager } from './pi-manager.js';
import { PiSessionFactory } from './pi-session.js';
import { createLlmClient } from './llm-client.js';
import { startScheduler } from './scheduler.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  // 全局异常处理，防止 Pi SDK 依赖加载崩溃导致进程退出
  process.on('uncaughtException', (err) => {
    console.error('[FATAL]', err.message);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[FATAL]', (err as Error).message);
  });
  // 首次启动配置检查
  await ensureSetup();

  const config = loadConfig();
  const logger = createLogger(`${config.dataDir}/logs`);

  logger.info(`PiPal v${process.env.npm_package_version ?? '0.1.0'} 启动`);
  logger.info(`LLM 提供商: ${config.llm.provider}`);
  logger.info(`平台: ${config.platform.type}`);

  const llm = createLlmClient(config.llm);

  const api = createApiClient(
    config.platform.wechat.apiBase,
    config.platform.wechat.botToken,
    config.platform.wechat.botType,
  );
  const adapter = new WeChatIlinkAdapter(
    api,
    config.platform.wechat.botToken,
    process.env.WECHAT_ILINK_USER_ID ?? '',
    async (token, userId) => {
      writeEnvVar('WECHAT_ILINK_BOT_TOKEN', token);
      writeEnvVar('WECHAT_ILINK_USER_ID', userId);
      logger.info('已保存微信登录凭证到 .env');
    },
    logger,
  );

  // 命令系统
  const memory = new PermanentMemory(
    `${config.dataDir}/memories/permanent.json`,
  );
  const stats: BotStats = {
    totalMessages: 0,
    startTime: new Date(),
  };

  // LLM 对话管理器
  const workspaceDir = join(process.cwd(), 'workspace');
  mkdirSync(workspaceDir, { recursive: true });
  const piFactory = new PiSessionFactory();
  const sessionManager = new SessionManager({
    llm: config.llm,
    dataDir: config.dataDir,
    piFactory,
    workspaceDir,
    logger,
  });

  const router = new CommandRouter();
  router.register(createHelpCommand(router));
  router.register(createStatusCommand(stats, sessionManager));
  router.register(createMemoriesCommand(memory));
  router.register(createPromptCommand(sessionManager, config.dataDir));
  router.register(createStopCommand(sessionManager));
  router.register(createSudoCommand(sessionManager));
  router.register(createExitCommand(sessionManager));
  router.register(createRollbackCommand(sessionManager));
  router.register(createRecallCommand(sessionManager));

  // 定时任务系统
  const archive = createArchive(`${config.dataDir}/archives`);

  // 跟踪用户 conversationId，供定时任务发送消息（从 .env 恢复，重启不丢失）
  let userConversationId: string | undefined = process.env.WECHAT_ILINK_USER_ID || undefined;

  const sendMessageToUser = async (content: string): Promise<void> => {
    if (userConversationId) {
      await adapter.sendMessage(userConversationId, content);
    } else {
      logger.warn('尚无用户会话，无法发送消息: ' + content.slice(0, 50));
    }
  };

  // 启动时预创建 session（避免首次消息等待）
  sessionManager.ensureSession().catch((err: Error) => {
    logger.error('Session 预创建失败: ' + err.message);
  });

  const scheduler = startScheduler(config, {
    llm,
    archive,
    sendMessage: sendMessageToUser,
    dataDir: config.dataDir,
    workspaceDir,
    sessionManager,
    logger,
  });

  adapter.onMessage(async (msg: Message) => {
    logger.info(`收到消息 [${msg.fromUserId}]: ${msg.content}`);
    stats.totalMessages++;

    // 跟踪用户以便定时任务发送确认消息
    if (!userConversationId) {
      userConversationId = msg.conversationId;
    }

    const sendReply = (content: string) =>
      adapter.sendMessage(msg.conversationId, content);

    const ctx: CommandContext = {
      message: msg,
      sendReply,
      sendTyping: () =>
        adapter.sendTyping(msg.conversationId).catch(() => {}),
    };

    // 先尝试路由命令（/stop 等命令即使 Pi 忙碌也能处理）
    const handled = await router.handle(ctx);
    if (handled) {
      logger.info(`命令已执行: ${msg.content}`);
      return;
    }

    // Pi 正在处理上一条消息，拒绝新的非命令消息
    if (sessionManager.isProcessing) {
      await ctx.sendReply('正在处理上一条消息，请稍候。如果需要打断当前处理，请发送 /stop。');
      return;
    }

    // LLM 对话回复
    // 每 5 秒刷新一次输入状态，避免 WeChat 的 typing 状态过期
    ctx.sendTyping();
    const typingInterval = setInterval(() => {
      ctx.sendTyping().catch(() => {});
    }, 5000);
    try {
      const reply = await sessionManager.processMessage(
        msg.fromUserId,
        msg.content,
      );
      clearInterval(typingInterval);
      if (reply) {
        await ctx.sendReply(reply);
      }
    } catch (err) {
      clearInterval(typingInterval);
      logger.error('LLM 处理失败: ' + (err instanceof Error ? err.message : String(err)));
      if (err instanceof Error && err.stack) logger.debug(err.stack);
      await ctx.sendReply('抱歉，我暂时无法处理您的消息，请稍后重试。');
    }
  });

  await adapter.start();
  logger.info('PiPal 已启动，等待消息...');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('启动失败:', msg);
  process.exit(1);
});
