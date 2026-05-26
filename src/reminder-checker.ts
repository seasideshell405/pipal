import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { getBeijingNow } from './date-utils.js';

export interface Schedule {
  id: string;
  cron: string;
  prompt: string;
  oneShot: boolean;
  lastTriggeredAt?: string;
  createdAt: string;
}

export interface DueSchedule {
  id: string;
  triggerMessage: string;
}

// ── cron matching ──

function matchField(pattern: string, value: number): boolean {
  if (pattern === '*') return true;

  // */N
  if (pattern.startsWith('*/')) {
    const n = parseInt(pattern.slice(2), 10);
    return !isNaN(n) && n > 0 && value % n === 0;
  }

  // N-M (range)
  const rangeMatch = pattern.match(/^(\d+)-(\d+)$/);
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10);
    const hi = parseInt(rangeMatch[2], 10);
    return value >= lo && value <= hi;
  }

  // N,M,O (list)
  if (pattern.includes(',')) {
    return pattern.split(',').some(p => matchField(p.trim(), value));
  }

  // plain number
  return parseInt(pattern, 10) === value;
}

function matchCron(cronExpr: string, date: Date): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  // date 由 getBeijingNow() 生成，用 UTC getter 读取即得北京时间成分
  return (
    matchField(parts[0], date.getUTCMinutes()) &&
    matchField(parts[1], date.getUTCHours()) &&
    matchField(parts[2], date.getUTCDate()) &&
    matchField(parts[3], date.getUTCMonth() + 1) &&
    matchField(parts[4], date.getUTCDay())
  );
}

// ── file operations ──

function loadSchedules(filePath: string): Schedule[] {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSchedules(filePath: string, schedules: Schedule[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(schedules, null, 2), 'utf-8');
}

function loadCompleted(filePath: string): Record<string, unknown>[] {
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCompleted(filePath: string, records: Record<string, unknown>[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(records, null, 2), 'utf-8');
}

/**
 * 检查到期任务。
 * - oneShot=false（routine）: 触发后保留，记录 lastTriggeredAt 防重复
 * - oneShot=true（reminder）: 触发后从 tasks.json 移除，追加到 completed.json
 */
export function checkDueSchedules(
  schedulesPath: string,
  completedRemindersPath: string,
): DueSchedule[] {
  const schedules = loadSchedules(schedulesPath);
  if (schedules.length === 0) return [];

  const now = new Date();
  const bjNow = getBeijingNow(); // 北京时间，用于 cron 匹配，不依赖系统时区
  const due: DueSchedule[] = [];
  const updated: Schedule[] = [];

  for (const s of schedules) {
    if (!matchCron(s.cron, bjNow)) {
      updated.push(s);
      continue;
    }

    // routine: 同一分钟内已触发过则跳过（防重复）
    if (!s.oneShot && s.lastTriggeredAt) {
      const last = new Date(s.lastTriggeredAt);
      if (
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate() &&
        last.getHours() === now.getHours() &&
        last.getMinutes() === now.getMinutes()
      ) {
        updated.push(s);
        continue;
      }
    }

    due.push({ id: s.id, triggerMessage: s.prompt });

    if (s.oneShot) {
      // 归档一次性提醒
      const existing = loadCompleted(completedRemindersPath);
      existing.push({
        id: s.id,
        cron: s.cron,
        content: s.prompt,
        triggeredAt: now.toISOString(),
        createdAt: s.createdAt,
      });
      saveCompleted(completedRemindersPath, existing);
      // 不加入 updated → 相当于删除
    } else {
      s.lastTriggeredAt = now.toISOString();
      updated.push(s);
    }
  }

  if (due.length > 0) {
    saveSchedules(schedulesPath, updated);
  }

  return due;
}
