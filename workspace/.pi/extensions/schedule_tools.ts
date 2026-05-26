/**
 * schedule_tools — Pi 扩展
 *
 * 注册 create_task / list_tasks / delete_task 三个工具，
 * 让 Pi 管理自己的定时任务（routine 和 reminder 统一模型）。
 *
 * - oneShot=false（默认）：周期性例行任务，触发后保留继续等待下次
 * - oneShot=true：一次性提醒，触发后自动移入 data/schedules/completed.json
 *
 * 任务文件: workspace/data/schedules/tasks.json
 * 已触发记录: workspace/data/schedules/completed.json
 * Skill 文件: workspace/.pi/skills/{name}.md（Pi 自行管理）
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const SCHEDULES_PATH = path.resolve(process.cwd(), "workspace", "data", "schedules", "tasks.json");

interface Task {
  id: string;
  cron: string;
  prompt: string;
  oneShot: boolean;
  createdAt: string;
}

// 简单互斥锁，防止 create_task/delete_task 并发读写覆盖
let taskLock: Promise<void> = Promise.resolve();

async function withTaskLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const prev = taskLock;
  taskLock = new Promise<void>((resolve) => { release = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

async function loadTasks(): Promise<Task[]> {
  try {
    const raw = await fs.readFile(SCHEDULES_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function saveTasks(tasks: Task[]): Promise<void> {
  await fs.mkdir(path.dirname(SCHEDULES_PATH), { recursive: true });
  // 原子写入：先写临时文件再重命名，防止写入过程中崩溃导致文件损坏
  const tmp = SCHEDULES_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf-8");
  await fs.rename(tmp, SCHEDULES_PATH);
}

// ── create_task ──

const createTaskTool = defineTool({
  name: "create_task",
  label: "创建定时任务",
  description:
    "创建一个定时任务。" +
    "  - oneShot=false（默认）：周期性例行任务，到点触发并保留，如早安、每日播报" +
    "  - oneShot=true：一次性提醒，触发后自动归档，如提醒开会",
  parameters: Type.Object({
    cron: Type.String({
      description:
        "cron 表达式（5 段），如 0 8 * * *（每天早上 8 点）、*/15 * * * *（每 15 分钟）",
    }),
    prompt: Type.String({
      description: "触发时发给 Pi 的提示词。Pi 会根据内容自动匹配 skill 执行",
    }),
    oneShot: Type.Optional(
      Type.Boolean({
        description: "是否一次性（默认 false）。true=触发后归档，false=周期性保留",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const parts = params.cron.trim().split(/\s+/);
    if (parts.length !== 5) {
      return {
        content: [
          {
            type: "text",
            text: "cron 表达式格式错误，需要 5 段（分 时 日 月 周）",
          },
        ],
        details: undefined,
      };
    }

    const task: Task = {
      id: crypto.randomUUID(),
      cron: params.cron.trim(),
      prompt: params.prompt,
      oneShot: params.oneShot ?? false,
      createdAt: new Date().toISOString(),
    };

    await withTaskLock(async () => {
      const tasks = await loadTasks();
      tasks.push(task);
      await saveTasks(tasks);
    });

    const typeLabel = task.oneShot ? "一次性" : "例行";
    return {
      content: [
        {
          type: "text",
          text: `已创建${typeLabel}定时任务: ${params.prompt}\ncron: ${params.cron}`,
        },
      ],
      details: undefined,
    };
  },
});

// ── list_tasks ──

const listTasksTool = defineTool({
  name: "list_tasks",
  label: "查看定时任务",
  description: "查看所有定时任务（例行 + 一次性提醒）。",
  parameters: Type.Object({}),

  async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
    const all = await loadTasks();
    if (all.length === 0) {
      return { content: [{ type: "text", text: "暂无定时任务。" }], details: undefined };
    }

    const lines = all.map((t, i) => {
      const type = t.oneShot ? "一次性" : "例行";
      return `${i + 1}. [${type}] ${t.prompt} (cron: ${t.cron})`;
    });

    return { content: [{ type: "text", text: lines.join("\n\n") }], details: undefined };
  },
});

// ── delete_task ──

const deleteTaskTool = defineTool({
  name: "delete_task",
  label: "删除定时任务",
  description: "删除定时任务。支持任务 ID 或列表序号。",
  parameters: Type.Object({
    id: Type.String({ description: "任务 ID 或列表序号（从 list_tasks 获取）" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const result = await withTaskLock(async () => {
      const all = await loadTasks();
      const before = all.length;

      const filtered = all.filter((t) => t.id !== params.id);
      if (filtered.length < before) {
        await saveTasks(filtered);
        return { content: [{ type: "text", text: "已删除任务。" }], details: undefined };
      }

      // 按序号删除
      const index = parseInt(params.id, 10);
      if (!isNaN(index) && index > 0 && index <= all.length) {
        const removed = all.splice(index - 1, 1);
        await saveTasks(all);
        return {
          content: [{ type: "text", text: `已删除: "${removed[0].prompt}"` }],
          details: undefined,
        };
      }

      return {
        content: [{ type: "text", text: `未找到任务: "${params.id}"` }],
        details: undefined,
      };
    });
    return result;
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(createTaskTool);
  pi.registerTool(listTasksTool);
  pi.registerTool(deleteTaskTool);
}
