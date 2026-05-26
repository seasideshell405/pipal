import { cp, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from './logger.js';
import { formatDate } from './date-utils.js';

/**
 * 每日备份：将 data/（排除 backups/ 和 logs/）和 workspace/data/ 复制到 data/backups/YYYY-MM-DD/。
 * 纯文件复制，不涉及 git。无变更时不产生备份。
 */
export async function backupProject(projectDir: string, logger?: Logger): Promise<string | undefined> {
  const date = formatDate(new Date());
  const backupBase = join(projectDir, 'data', 'backups', date);

  const projectDataSrc = join(projectDir, 'data');
  const projectDst = join(backupBase, 'data');
  let hasAny = false;

  // 备份 data/ 下各子目录（排除 backups/ 和 logs/）
  const includeDirs = ['archives', 'memories', 'prompt', 'sessions'];
  for (const dir of includeDirs) {
    const src = join(projectDataSrc, dir);
    const dst = join(projectDst, dir);
    try {
      await cp(src, dst, { recursive: true, force: true });
      hasAny = true;
    } catch (err: unknown) {
      const e = err as { code?: string };
      if (e.code !== 'ENOENT') throw err;
    }
  }

  // 备份 permanent.json
  const pmSrc = join(projectDataSrc, 'memories', 'permanent.json');
  const pmDst = join(projectDst, 'memories', 'permanent.json');
  try {
    await cp(pmSrc, pmDst, { force: true });
    hasAny = true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code !== 'ENOENT') throw err;
  }

  // 备份 workspace/data/
  const wsSrc = join(projectDir, 'workspace', 'data');
  const wsDst = join(backupBase, 'workspace-data');
  try {
    await cp(wsSrc, wsDst, { recursive: true, force: true });
    hasAny = true;
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code !== 'ENOENT') throw err;
  }

  if (!hasAny) {
    logger?.info('备份无数据，跳过');
    return undefined;
  }

  logger?.info(`备份已完成 ${date}`);
  return date;
}
