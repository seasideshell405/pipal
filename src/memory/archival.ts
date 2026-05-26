import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { formatDate } from '../date-utils.js';

export interface ArchivalEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

export interface Archive {
  append(entry: ArchivalEntry): Promise<void>;
  query(date: string): Promise<ArchivalEntry[]>;
  popLast(date: string, count: number): Promise<void>;
}

export function createArchive(baseDir: string): Archive {
  const filePath = (date: string) => join(baseDir, `${date}.jsonl`);

  return {
    async append(entry: ArchivalEntry): Promise<void> {
      const date = formatDate(new Date());
      const fp = filePath(date);
      await mkdir(baseDir, { recursive: true });
      await appendFile(fp, JSON.stringify(entry) + '\n', 'utf-8');
    },

    async query(date: string): Promise<ArchivalEntry[]> {
      const fp = filePath(date);
      try {
        const content = await readFile(fp, 'utf-8');
        return content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      } catch (err: unknown) {
        const nodeErr = err as { code?: string };
        if (nodeErr.code === 'ENOENT') return [];
        throw err;
      }
    },

    async popLast(date: string, count: number): Promise<void> {
      const fp = filePath(date);
      try {
        const content = await readFile(fp, 'utf-8');
        const lines = content.split('\n').filter(Boolean);
        if (count >= lines.length) {
          await writeFile(fp, '', 'utf-8');
          return;
        }
        await writeFile(fp, lines.slice(0, -count).join('\n') + '\n', 'utf-8');
      } catch (err: unknown) {
        const nodeErr = err as { code?: string };
        if (nodeErr.code === 'ENOENT') return;
        throw err;
      }
    },
  };
}
