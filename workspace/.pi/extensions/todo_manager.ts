/**
 * todo_manager — Pi 扩展：四象限任务管理
 *
 * 注册 create_todo / list_todos / complete_todo / update_todo / delete_todo 工具，
 * 配合 todo_manager skill 使用，实现四象限任务的创建、查看、完成、更新、删除。
 *
 * 数据文件: workspace/data/todos/tasks.json
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── 数据路径 ────────────────────────────────────────────
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./workspace/data");
const TODOS_DIR = path.join(DATA_DIR, "todos");
const TASKS_PATH = path.join(TODOS_DIR, "tasks.json");

// ── 类型 ────────────────────────────────────────────────

type Importance = "important" | "unimportant";
type Urgency = "urgent" | "not_urgent";
type TodoStatus = "pending" | "done";

interface TodoItem {
  id: string;
  content: string;
  importance: Importance;
  /** 创建时设定的紧急度。not_urgent 如果有截止日期+阈值可能自动变 urgent */
  urgency: Urgency;
  /** 截止日期 YYYY-MM-DD，可选 */
  dueDate?: string;
  /** 不紧急→紧急的阈值天数，可选 */
  thresholdDays?: number;
  status: TodoStatus;
  createdAt: string;
}

// ── 工具函数 ────────────────────────────────────────────

async function loadTasks(): Promise<TodoItem[]> {
  try {
    const raw = await fs.readFile(TASKS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function saveTasks(tasks: TodoItem[]): Promise<void> {
  await fs.mkdir(TODOS_DIR, { recursive: true });
  const tmp = TASKS_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2), "utf-8");
  await fs.rename(tmp, TASKS_PATH);
}

/** 计算某个任务当前的紧急度（动态计算，不修改原数据） */
function computeCurrentUrgency(task: TodoItem): Urgency {
  // 创建时就是紧急的，永远不变
  if (task.urgency === "urgent") return "urgent";

  // 不紧急但没设截止日期或阈值，永远不变
  if (!task.dueDate || task.thresholdDays === undefined || task.thresholdDays === null) {
    return "not_urgent";
  }

  // 有截止日期 + 有阈值 → 动态判断
  const now = new Date();
  const due = new Date(task.dueDate + "T23:59:59+08:00"); // 截止日当天23:59
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < task.thresholdDays) {
    return "urgent";
  }
  return "not_urgent";
}

// ── 工具 1: create_todo ─────────────────────────────────

const createTodo = defineTool({
  name: "create_todo",
  label: "创建任务",
  description: "创建一个四象限任务。",
  parameters: Type.Object({
    content: Type.String({ description: "任务内容" }),
    importance: Type.Union([Type.Literal("important"), Type.Literal("unimportant")], {
      description: "重要性：important（重要）或 unimportant（不重要）",
    }),
    urgency: Type.Union([Type.Literal("urgent"), Type.Literal("not_urgent")], {
      description: "紧急度：urgent（紧急）或 not_urgent（不紧急）",
    }),
    dueDate: Type.Optional(
      Type.String({ description: "截止日期 YYYY-MM-DD，可选" }),
    ),
    thresholdDays: Type.Optional(
      Type.Number({ description: "不紧急→紧急的阈值天数，可选" }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const tasks = await loadTasks();

    const task: TodoItem = {
      id: crypto.randomUUID(),
      content: params.content,
      importance: params.importance,
      urgency: params.urgency,
      status: "pending",
      createdAt: new Date().toISOString(),
    };

    if (params.dueDate) task.dueDate = params.dueDate;
    if (params.thresholdDays !== undefined && params.thresholdDays !== null) {
      task.thresholdDays = params.thresholdDays;
    }

    // 校验：如果不紧急但设了 thresholdDays，必须有 dueDate
    if (task.urgency === "not_urgent" && task.thresholdDays !== undefined && !task.dueDate) {
      return {
        content: [{
          type: "text",
          text: "⚠️ 设置了自动转化阈值，但未填写截止日期，请补充截止日期后再试。",
        }],
      };
    }

    tasks.push(task);
    await saveTasks(tasks);

    const importanceLabel = task.importance === "important" ? "重要" : "不重要";
    const urgencyLabel = computeCurrentUrgency(task) === "urgent" ? "紧急" : "不紧急";

    return {
      content: [{
        type: "text",
        text: `✅ 已创建任务「${task.content}」→ ${importanceLabel} · ${urgencyLabel}`,
      }],
      details: { task },
    };
  },
});

// ── 工具 2: list_todos ──────────────────────────────────

const listTodos = defineTool({
  name: "list_todos",
  label: "查看任务",
  description: "获取任务列表。status=pending 返回待办任务，status=done 返回已完成任务。",
  parameters: Type.Object({
    status: Type.Union([Type.Literal("pending"), Type.Literal("done")], {
      description: "pending=查看待办 | done=查看已完成",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const tasks = await loadTasks();

    // 按 status 过滤
    const filtered = tasks.filter((t) => t.status === params.status);

    // 为每个任务计算当前紧急度（动态）
    const enriched = filtered.map((t) => ({
      ...t,
      currentUrgency: computeCurrentUrgency(t),
    }));

    // 待办按创建时间倒序，已完成按完成时间倒序
    enriched.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      content: [{
        type: "text",
        text: `${params.status === "pending" ? "待办" : "已完成"}任务共 ${enriched.length} 个`,
      }],
      details: { tasks: enriched },
    };
  },
});

// ── 工具 3: complete_todo ───────────────────────────────

const completeTodo = defineTool({
  name: "complete_todo",
  label: "完成任务",
  description: "将任务标记为已完成。",
  parameters: Type.Object({
    id: Type.String({ description: "任务 ID" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const tasks = await loadTasks();
    const idx = tasks.findIndex((t) => t.id === params.id);
    if (idx === -1) {
      return { content: [{ type: "text", text: "❌ 未找到该任务" }] };
    }
    tasks[idx].status = "done";
    await saveTasks(tasks);
    return {
      content: [{ type: "text", text: `✅ 已完成「${tasks[idx].content}」🎉` }],
      details: { task: tasks[idx] },
    };
  },
});

// ── 工具 4: update_todo ─────────────────────────────────

const updateTodo = defineTool({
  name: "update_todo",
  label: "更新任务",
  description: "更新任务的字段（内容、重要性、紧急度、截止日期、阈值等）。",
  parameters: Type.Object({
    id: Type.String({ description: "任务 ID" }),
    content: Type.Optional(Type.String({ description: "新的任务内容" })),
    importance: Type.Optional(
      Type.Union([Type.Literal("important"), Type.Literal("unimportant")], {
        description: "新的重要性",
      }),
    ),
    urgency: Type.Optional(
      Type.Union([Type.Literal("urgent"), Type.Literal("not_urgent")], {
        description: "新的紧急度",
      }),
    ),
    dueDate: Type.Optional(
      Type.String({ description: "新的截止日期 YYYY-MM-DD" }),
    ),
    thresholdDays: Type.Optional(
      Type.Number({ description: "新的阈值天数" }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const tasks = await loadTasks();
    const idx = tasks.findIndex((t) => t.id === params.id);
    if (idx === -1) {
      return { content: [{ type: "text", text: "❌ 未找到该任务" }] };
    }

    const task = tasks[idx];
    if (params.content !== undefined) task.content = params.content;
    if (params.importance !== undefined) task.importance = params.importance;
    if (params.urgency !== undefined) task.urgency = params.urgency;
    if (params.dueDate !== undefined) task.dueDate = params.dueDate;
    if (params.thresholdDays !== undefined) task.thresholdDays = params.thresholdDays;

    await saveTasks(tasks);
    const currentUrgency = computeCurrentUrgency(task);
    const importanceLabel = task.importance === "important" ? "重要" : "不重要";
    const urgencyLabel = currentUrgency === "urgent" ? "紧急" : "不紧急";

    return {
      content: [{
        type: "text",
        text: `✅ 已更新「${task.content}」→ ${importanceLabel} · ${urgencyLabel}`,
      }],
      details: { task },
    };
  },
});

// ── 工具 5: delete_todo ─────────────────────────────────

const deleteTodo = defineTool({
  name: "delete_todo",
  label: "删除任务",
  description: "删除一个任务。",
  parameters: Type.Object({
    id: Type.String({ description: "任务 ID" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const tasks = await loadTasks();
    const idx = tasks.findIndex((t) => t.id === params.id);
    if (idx === -1) {
      return { content: [{ type: "text", text: "❌ 未找到该任务" }] };
    }
    const removed = tasks.splice(idx, 1)[0];
    await saveTasks(tasks);
    return {
      content: [{ type: "text", text: `🗑️ 已删除「${removed.content}」` }],
      details: { task: removed },
    };
  },
});

// ── 注册扩展 ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(createTodo);
  pi.registerTool(listTodos);
  pi.registerTool(completeTodo);
  pi.registerTool(updateTodo);
  pi.registerTool(deleteTodo);
}
