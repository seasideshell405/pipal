/**
 * memory_tools — Pi 扩展
 *
 * 注册 add_memory / list_memories / delete_memory 三个工具，
 * 让 Pi 在对话中自主管理永久记忆。
 * 读写 data/memory/permanent.json，与 PiPal 的 PermanentMemory 共享数据。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const MEMORY_PATH = path.resolve(
  process.env.DATA_DIR ?? "./data",
  "memory",
  "permanent.json",
);

interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
}

async function loadEntries(): Promise<MemoryEntry[]> {
  try {
    const raw = await fs.readFile(MEMORY_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveEntries(entries: MemoryEntry[]): Promise<void> {
  await fs.mkdir(path.dirname(MEMORY_PATH), { recursive: true });
  await fs.writeFile(MEMORY_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

const addTool = defineTool({
  name: "add_memory",
  label: "添加永久记忆",
  description:
    "添加一条永久记忆。用于记录用户希望长期保留的个人事实、偏好、习惯和重要决定。",
  parameters: Type.Object({
    content: Type.String({ description: "要记住的内容" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const entries = await loadEntries();
    const entry: MemoryEntry = {
      id: crypto.randomUUID(),
      content: params.content,
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    await saveEntries(entries);
    return {
      content: [{ type: "text", text: `已添加永久记忆 (ID: ${entry.id})` }],
      details: undefined,
    };
  },
});

const listTool = defineTool({
  name: "list_memories",
  label: "查看永久记忆",
  description: "查看所有永久记忆列表。",
  parameters: Type.Object({}),

  async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
    try {
      const raw = await fs.readFile(MEMORY_PATH, "utf-8");
      const entries: MemoryEntry[] = JSON.parse(raw);
      if (entries.length === 0) {
        return { content: [{ type: "text", text: "暂无永久记忆。" }], details: undefined };
      }
      const text = entries
        .map(
          (e, i) =>
            `${i + 1}. ${e.content}（${new Date(e.createdAt).toLocaleDateString("zh-CN")}）`,
        )
        .join("\n");
      return { content: [{ type: "text", text }], details: undefined };
    } catch {
      return { content: [{ type: "text", text: "暂无永久记忆。" }], details: undefined };
    }
  },
});

const deleteTool = defineTool({
  name: "delete_memory",
  label: "删除永久记忆",
  description: "删除永久记忆。删除不可恢复，谨慎操作。支持按序号或关键词匹配内容删除。",
  parameters: Type.Object({
    query: Type.String({
      description:
        "要删除的记忆关键词或序号（序号从 list_memories 的结果中获取）",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const entries = await loadEntries();
    const before = entries.length;

    const index = parseInt(params.query, 10);
    if (!isNaN(index) && index > 0 && index <= entries.length) {
      const removed = entries.splice(index - 1, 1);
      await saveEntries(entries);
      return {
        content: [
          { type: "text", text: `已删除记忆: "${removed[0].content}"` },
        ],
        details: undefined,
      };
    }

    const remaining = entries.filter(
      (e) => !e.content.includes(params.query),
    );
    const count = before - remaining.length;
    if (count > 0) {
      await saveEntries(remaining);
      return {
        content: [
          {
            type: "text",
            text: `已删除 ${count} 条包含 "${params.query}" 的记忆`,
          },
        ],
        details: undefined,
      };
    }

    return {
      content: [
        { type: "text", text: `未找到匹配的记忆: "${params.query}"` },
      ],
      details: undefined,
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(addTool);
  pi.registerTool(listTool);
  pi.registerTool(deleteTool);
}
