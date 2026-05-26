import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { formatDate } from '../date-utils.js';

export interface MemoryContext {
  shortTerm: string[];
  mediumTerm: string[];
  permanent: string[];
}

function getSunday(d: Date): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

export async function loadMemoryContext(options: { dataDir: string }): Promise<MemoryContext> {
  const { dataDir } = options;

  const shortTerm = await loadShortTerm(dataDir);
  const mediumTerm = await loadMediumTerm(dataDir);
  const permanent = loadPermanent(dataDir);

  return { shortTerm, mediumTerm, permanent };
}

async function loadShortTerm(dataDir: string): Promise<string[]> {
  const dailyDir = join(dataDir, 'memories', 'daily');
  const results: string[] = [];

  const sunday = getSunday(new Date());
  const today = new Date();

  for (let d = new Date(sunday); d <= today; d.setDate(d.getDate() + 1)) {
    const filePath = join(dailyDir, `${formatDate(d)}.md`);
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) results.push(content);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

async function loadMediumTerm(dataDir: string): Promise<string[]> {
  const weeklyDir = join(dataDir, 'memories', 'weekly');
  const results: string[] = [];

  try {
    const files = await readdir(weeklyDir);
    const weekFiles = files
      .filter(f => f.endsWith('.md'))
      .sort()
      .slice(-4); // Last 4 weeks

    for (const file of weekFiles) {
      const filePath = join(weeklyDir, file);
      try {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) results.push(content);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}

function loadPermanent(dataDir: string): string[] {
  const filePath = join(dataDir, 'memories', 'permanent.json');
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return [];
    return entries.map((e: { content?: string }) => e.content ?? '').filter(Boolean);
  } catch {
    return [];
  }
}
