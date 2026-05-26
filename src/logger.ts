import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { formatDate, formatTs } from './date-utils.js';

const levels = ['debug', 'info', 'warn', 'error'] as const;
type Level = typeof levels[number];

export function createLogger(logDir: string) {
  mkdirSync(logDir, { recursive: true });

  let currentDate = '';
  let logPath = '';

  function ensurePath() {
    const today = formatDate(new Date());
    if (today !== currentDate) {
      currentDate = today;
      logPath = join(logDir, `${today}.log`);
    }
    return logPath;
  }

  function write(level: Level, msg: string, ...args: unknown[]) {
    const line = args.length > 0
      ? `${msg} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`
      : msg;

    const ts = formatTs(new Date());
    const entry = `[${ts}] [${level.toUpperCase()}] ${line}`;

    // stdout
    console.log(entry);

    // file
    try {
      appendFileSync(ensurePath(), entry + '\n', 'utf-8');
    } catch {
      // fail silently – don't let logging break the app
    }
  }

  return {
    debug: (msg: string, ...args: unknown[]) => write('debug', msg, ...args),
    info: (msg: string, ...args: unknown[]) => write('info', msg, ...args),
    warn: (msg: string, ...args: unknown[]) => write('warn', msg, ...args),
    error: (msg: string, ...args: unknown[]) => write('error', msg, ...args),
  };
}

export type Logger = ReturnType<typeof createLogger>;
