import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

export class PermanentMemory {
  private entries: MemoryEntry[] = [];

  constructor(private filePath: string) {
    this.load();
  }

  list(): MemoryEntry[] {
    this.load();
    return [...this.entries];
  }

  add(content: string): MemoryEntry {
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      createdAt: new Date().toISOString(),
    };
    this.entries.push(entry);
    this.save();
    return entry;
  }

  remove(idOrKeyword: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => e.id !== idOrKeyword && !e.content.includes(idOrKeyword)
    );
    const removed = before !== this.entries.length;
    if (removed) this.save();
    return removed;
  }

  count(): number {
    return this.entries.length;
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8').trim();
        if (!raw) {
          this.entries = [];
          return;
        }
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.entries = parsed.filter(
            (e: unknown): e is MemoryEntry =>
              typeof e === 'object' && e !== null &&
              typeof (e as MemoryEntry).id === 'string' &&
              typeof (e as MemoryEntry).content === 'string' &&
              typeof (e as MemoryEntry).createdAt === 'string'
          );
        }
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2), 'utf-8');
  }
}
