import { join } from 'node:path';
import cron from 'node-cron';
import type { AppConfig } from './types.js';
import type { LlmClient } from './llm-client.js';
import type { Logger } from './logger.js';
import type { Archive } from './memory/archival.js';
import type { SessionManager } from './pi-manager.js';
import { generateYesterdaySummary } from './memory/daily-summary.js';
import { generateWeeklySummary } from './memory/weekly-summary.js';
import { checkDueSchedules } from './reminder-checker.js';
import { backupProject } from './backup.js';

export interface SchedulerServices {
  llm: LlmClient;
  archive: Archive;
  sendMessage: (content: string) => Promise<void>;
  dataDir: string;
  workspaceDir: string;
  sessionManager: SessionManager;
  logger: Logger;
}

export interface SchedulerHandle {
  stopAll: () => void;
}

/**
 * 启动所有定时任务。
 * 根据配置的 cron 表达式注册每日摘要、每周总结、session轮换任务。
 */
export function startScheduler(
  config: AppConfig,
  services: SchedulerServices,
): SchedulerHandle {
  const tasks: cron.ScheduledTask[] = [];

  const log = services.logger;

  // 每日摘要
  const dailyTask = cron.schedule(config.cron.dailySummary, () => {
    log.info('开始生成每日摘要...');
    generateYesterdaySummary(services.llm, services.archive, services.dataDir)
      .then(() => {
        log.info('每日摘要生成完成');
      })
      .catch((err: Error) => {
        log.error('每日摘要生成失败: ' + err.message);
      });
  });
  tasks.push(dailyTask);

  // 每周总结
  const weeklyTask = cron.schedule(config.cron.weeklySummary, () => {
    log.info('开始生成每周总结...');
    generateWeeklySummary(services.llm, services.dataDir)
      .then(() => {
        log.info('每周总结生成完成');
      })
      .catch((err: Error) => {
        log.error('每周总结生成失败: ' + err.message);
      });
  });
  tasks.push(weeklyTask);

  // Session 轮换
  const rotationTask = cron.schedule(config.cron.sessionRotation, () => {
    services.sessionManager.rotate().catch((err: Error) => {
      log.error('Session 轮换失败: ' + err.message);
    });
  });
  tasks.push(rotationTask);

  // 项目备份（默认每天 6:00）
  const backupTask = cron.schedule(config.cron.backup, () => {
    backupProject(process.cwd(), log).catch((err: Error) => {
      log.error('备份失败: ' + err.message);
    });
  });
  tasks.push(backupTask);

  // 定时检查（每分钟）
  const schedulesPath = join(services.workspaceDir, 'data', 'schedules', 'tasks.json');
  const completedPath = join(services.workspaceDir, 'data', 'schedules', 'completed.json');
  const scheduleTask = cron.schedule('* * * * *', async () => {
    const due = checkDueSchedules(schedulesPath, completedPath);
    if (due.length === 0) return;

    log.info(`${due.length} 条任务到期，开始处理`);
    for (const d of due) {
      try {
        const reply = await services.sessionManager.processMessage(
          'system',
          `【系统定时任务】${d.triggerMessage}`,
        );
        if (reply) {
          await services.sendMessage(reply);
        }
      } catch (err) {
        log.error(`定时任务处理失败: ${d.triggerMessage} — ${(err as Error).message}`);
      }
    }
  });
  tasks.push(scheduleTask);

  log.info(
    `已启动 ${tasks.length} 个定时任务：每日摘要（${config.cron.dailySummary}）、每周总结（${config.cron.weeklySummary}）、Session 轮换（${config.cron.sessionRotation}）、项目备份（${config.cron.backup}）、提醒检查（每分钟）`,
  );

  return {
    stopAll: () => {
      for (const t of tasks) {
        t.stop();
      }
      log.info('所有定时任务已停止');
    },
  };
}
