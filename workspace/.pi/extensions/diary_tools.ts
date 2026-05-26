/**
 * diary_tools — Pi 扩展：日记功能
 *
 * 注册 write_diary / list_diaries / read_diary / delete_diary 四个工具，
 * 让 Pi 在对话中帮用户记录和回顾日记。
 *
 * 每天一个独立 .md 文件存储正文，index.json 存储元数据索引。
 * 凌晨 4 点前写的日记归为前一天。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── 数据路径 ────────────────────────────────────────────
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./workspace/data");
const DIARY_DIR = path.join(DATA_DIR, "diary");
const INDEX_PATH = path.join(DIARY_DIR, "index.json");

// ── 类型 ────────────────────────────────────────────────
interface DiaryMeta {
  id: string;
  date: string; // YYYY-MM-DD
  createdAt: string;
  updatedAt: string;
  mood: string;
  tags: string[];
  preview: string; // 正文前 50 字
}

/** 日记正文文件路径 */
function diaryFilePath(date: string): string {
  return path.join(DIARY_DIR, `${date}.md`);
}

// ── 工具函数 ────────────────────────────────────────────

/** 获取日记日期：凌晨 4 点前算前一天 */
function getDiaryDate(date?: Date): string {
  const d = date ?? new Date();
  const target = new Date(d);
  if (target.getHours() < 4) {
    target.setDate(target.getDate() - 1);
  }
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const day = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 生成正文预览（取前 50 字，去除换行） */
function makePreview(content: string): string {
  const plain = content.replace(/\s+/g, " ").trim();
  return plain.length > 50 ? plain.slice(0, 50) + "…" : plain;
}

async function loadIndex(): Promise<DiaryMeta[]> {
  try {
    const raw = await fs.readFile(INDEX_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveIndex(entries: DiaryMeta[]): Promise<void> {
  await fs.mkdir(DIARY_DIR, { recursive: true });
  await fs.writeFile(INDEX_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

/** 读取某天的正文内容 */
async function readContent(date: string): Promise<string | null> {
  try {
    return await fs.readFile(diaryFilePath(date), "utf-8");
  } catch {
    return null;
  }
}

/** 写入正文（追加模式） */
async function appendContent(date: string, content: string): Promise<void> {
  await fs.mkdir(DIARY_DIR, { recursive: true });
  const filePath = diaryFilePath(date);
  try {
    // 文件已存在，追加
    const existing = await fs.readFile(filePath, "utf-8");
    await fs.writeFile(filePath, existing + "\n\n---\n\n" + content, "utf-8");
  } catch {
    // 文件不存在，新建
    await fs.writeFile(filePath, content, "utf-8");
  }
}

/** 覆盖写入正文 */
async function writeContent(date: string, content: string): Promise<void> {
  await fs.mkdir(DIARY_DIR, { recursive: true });
  await fs.writeFile(diaryFilePath(date), content, "utf-8");
}

// ── 工具 1：写日记 ──────────────────────────────────────

const writeDiary = defineTool({
  name: "write_diary",
  label: "写日记",
  description:
    "写一篇日记。每天一个独立文件存储。如果当天已有日记则追加内容。日期自动按「凌晨4点前算前一天」处理，也可手动指定。",
  parameters: Type.Object({
    content: Type.String({ description: "日记正文内容" }),
    mood: Type.Optional(Type.String({ description: "今天的心情，如：开心、平静、疲惫、焦虑…" })),
    tags: Type.Optional(Type.Array(Type.String(), { description: "标签列表，如 ['工作', '学习']" })),
    date: Type.Optional(Type.String({ description: "日期 YYYY-MM-DD，不传则自动计算" })),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const diaryDate = params.date ?? getDiaryDate();
    const now = new Date().toISOString();

    // 追加正文
    await appendContent(diaryDate, params.content);

    // 更新索引
    const index = await loadIndex();
    const existingIndex = index.findIndex((e) => e.date === diaryDate);

    if (existingIndex >= 0) {
      // 合并元数据
      const existing = index[existingIndex];
      const mergedTags = [
        ...new Set([...(existing.tags ?? []), ...(params.tags ?? [])]),
      ];
      // 重新读取完整正文来生成预览
      const fullContent = await readContent(diaryDate);
      index[existingIndex] = {
        ...existing,
        mood: params.mood ?? existing.mood,
        tags: mergedTags,
        updatedAt: now,
        preview: makePreview(fullContent ?? params.content),
      };
    } else {
      // 新建索引条目
      const meta: DiaryMeta = {
        id: crypto.randomUUID(),
        date: diaryDate,
        createdAt: now,
        updatedAt: now,
        mood: params.mood ?? "",
        tags: params.tags ?? [],
        preview: makePreview(params.content),
      };
      index.push(meta);
      index.sort((a, b) => b.date.localeCompare(a.date));
    }

    await saveIndex(index);

    const tagStr =
      params.tags && params.tags.length > 0
        ? ` 🏷️ ${params.tags.join("、")}`
        : "";
    return {
      content: [
        {
          type: "text",
          text: `✅ ${diaryDate} 的日记已保存${tagStr}${
            params.mood ? `（心情：${params.mood}）` : ""
          }`,
        },
      ],
      details: undefined,
    };
  },
});

// ── 工具 2：浏览日记列表 ────────────────────────────────

const listDiaries = defineTool({
  name: "list_diaries",
  label: "浏览日记",
  description:
    "查看日记列表。可按月份、心情、标签筛选。不传参则返回最近 30 篇。",
  parameters: Type.Object({
    month: Type.Optional(
      Type.String({ description: "筛选月份，格式 YYYY-MM，如 2026-05" }),
    ),
    mood: Type.Optional(Type.String({ description: "按心情筛选" })),
    tag: Type.Optional(Type.String({ description: "按标签筛选" })),
    limit: Type.Optional(
      Type.Number({ description: "返回条数，默认 30，最大 100" }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const index = await loadIndex();
    const limit = Math.min(params.limit ?? 30, 100);

    let filtered = index;

    if (params.month) {
      filtered = filtered.filter((e) => e.date.startsWith(params.month!));
    }
    if (params.mood) {
      filtered = filtered.filter((e) => e.mood.includes(params.mood!));
    }
    if (params.tag) {
      filtered = filtered.filter((e) =>
        (e.tags ?? []).some((t) => t.includes(params.tag!)),
      );
    }

    // 日期降序
    filtered.sort((a, b) => b.date.localeCompare(a.date));
    const sliced = filtered.slice(0, limit);

    if (sliced.length === 0) {
      return {
        content: [{ type: "text", text: "📭 暂无匹配的日记。" }],
        details: undefined,
      };
    }

    const lines = sliced.map((e, i) => {
      const moodStr = e.mood ? ` 😊${e.mood}` : "";
      const tagStr =
        e.tags.length > 0 ? ` 🏷️${e.tags.join("、")}` : "";
      return `${i + 1}. **${e.date}**${moodStr}${tagStr}\n   > ${e.preview}`;
    });

    return {
      content: [
        {
          type: "text",
          text: `📖 共找到 ${filtered.length} 篇日记，显示前 ${sliced.length} 篇：\n\n${lines.join("\n\n")}`,
        },
      ],
      details: undefined,
    };
  },
});

// ── 工具 3：查看某天日记详情 ────────────────────────────

const readDiary = defineTool({
  name: "read_diary",
  label: "查看日记详情",
  description: "查看某一天的完整日记内容。每天一个独立文件。",
  parameters: Type.Object({
    date: Type.String({
      description: "日期 YYYY-MM-DD，如 2026-05-25。支持 today / yesterday",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    let targetDate = params.date;

    // 处理快捷日期
    if (targetDate === "today") {
      targetDate = getDiaryDate();
    } else if (targetDate === "yesterday") {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      targetDate = getDiaryDate(d);
    }

    const index = await loadIndex();
    const meta = index.find((e) => e.date === targetDate);
    const content = await readContent(targetDate);

    if (!content && !meta) {
      return {
        content: [
          { type: "text", text: `📭 ${targetDate} 还没有写日记哦。` },
        ],
        details: undefined,
      };
    }

    const moodStr = meta?.mood ? `**心情：** ${meta.mood}` : "";
    const tagStr =
      meta?.tags && meta.tags.length > 0
        ? `**标签：** ${meta.tags.join("、")}`
        : "";
    const createdAt = meta?.createdAt
      ? new Date(meta.createdAt).toLocaleString("zh-CN")
      : "未知";

    return {
      content: [
        {
          type: "text",
          text: `📖 **${targetDate} 的日记**\n${moodStr}${moodStr && tagStr ? " | " : ""}${tagStr}\n\n${content ?? "（内容为空）"}\n\n— ${createdAt} 记录`,
        },
      ],
      details: undefined,
    };
  },
});

// ── 工具 4：删除日记 ────────────────────────────────────

const deleteDiary = defineTool({
  name: "delete_diary",
  label: "删除日记",
  description: "删除某一天的日记。不可恢复，请谨慎操作。",
  parameters: Type.Object({
    date: Type.String({
      description: "要删除的日记日期 YYYY-MM-DD",
    }),
    confirm: Type.Boolean({
      description: "确认删除，必须传 true",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    if (!params.confirm) {
      return {
        content: [
          {
            type: "text",
            text: "⚠️ 请传入 confirm: true 确认删除。此操作不可恢复！",
          },
        ],
        details: undefined,
      };
    }

    // 删除正文文件
    try {
      await fs.unlink(diaryFilePath(params.date));
    } catch {
      // 文件不存在，忽略
    }

    // 从索引中移除
    const index = await loadIndex();
    const before = index.length;
    const remaining = index.filter((e) => e.date !== params.date);
    const count = before - remaining.length;

    if (count === 0) {
      return {
        content: [
          { type: "text", text: `📭 ${params.date} 没有日记可删除。` },
        ],
        details: undefined,
      };
    }

    await saveIndex(remaining);
    return {
      content: [
        {
          type: "text",
          text: `🗑️ 已删除 ${params.date} 的日记（共 ${count} 篇），已移除对应的 .md 文件。`,
        },
      ],
      details: undefined,
    };
  },
});

// ── 注册扩展 ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(writeDiary);
  pi.registerTool(listDiaries);
  pi.registerTool(readDiary);
  pi.registerTool(deleteDiary);
}
