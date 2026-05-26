/**
 * diet_planner — Pi 扩展：饮食规划
 *
 * 注册 record_meal / get_weekly_summary 两个工具，
 * 配合 diet_planner skill 和定时任务，实现饮食推荐、记录和周总结。
 *
 * 数据文件: workspace/data/diet/records.json
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// ── 数据路径 ────────────────────────────────────────────
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./workspace/data");
const DIET_DIR = path.join(DATA_DIR, "diet");
const RECORDS_PATH = path.join(DIET_DIR, "records.json");

// ── 类型 ────────────────────────────────────────────────
interface MealRecord {
  id: string;
  date: string; // YYYY-MM-DD
  mealType: "lunch" | "dinner";
  foods: string[];
  recommended: string; // 推荐的方案描述
  notes: string;
  createdAt: string;
}

// ── 工具函数 ────────────────────────────────────────────

async function loadRecords(): Promise<MealRecord[]> {
  try {
    const raw = await fs.readFile(RECORDS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

async function saveRecords(records: MealRecord[]): Promise<void> {
  await fs.mkdir(DIET_DIR, { recursive: true });
  const tmp = RECORDS_PATH + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(records, null, 2), "utf-8");
  await fs.rename(tmp, RECORDS_PATH);
}

/**
 * 获取 ISO 周数
 * 参考: https://weeknumber.com/how-to/javascript
 */
function getISOWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
}

/** 获取某周的起止日期 (YYYY-MM-DD) */
function getWeekDateRange(year: number, week: number): { start: string; end: string } {
  const jan1 = new Date(year, 0, 1);
  const dayNum = jan1.getDay() || 7; // 1=Mon ... 7=Sun
  // 计算该年第 week 周的周一
  const monday = new Date(year, 0, 1 + (week - 1) * 7 - dayNum + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  return { start: fmt(monday), end: fmt(sunday) };
}

// ── 工具 1: record_meal ────────────────────────────────

const recordMeal = defineTool({
  name: "record_meal",
  label: "记录饮食",
  description: "记录一餐的实际选择。由 Pi 在用户反馈吃什么后调用。",
  parameters: Type.Object({
    date: Type.String({
      description: "日期，格式 YYYY-MM-DD，如 2026-05-26",
    }),
    mealType: Type.Union([Type.Literal("lunch"), Type.Literal("dinner")], {
      description: "餐型：lunch（午餐）或 dinner（晚餐）",
    }),
    foods: Type.Array(Type.String(), {
      description: "实际吃的食物列表，如 ['香煎鸡胸肉', '糙米饭', '西兰花']",
    }),
    recommended: Type.Optional(
      Type.String({
        description: "当时推荐的方案描述（用户可能没按推荐吃，纯记录用），可选",
      }),
    ),
    notes: Type.Optional(
      Type.String({
        description: "备注信息，如 '食堂吃的'、'自己做的' 等",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const records = await loadRecords();

    const record: MealRecord = {
      id: crypto.randomUUID(),
      date: params.date,
      mealType: params.mealType,
      foods: params.foods,
      recommended: params.recommended ?? "",
      notes: params.notes ?? "",
      createdAt: new Date().toISOString(),
    };

    records.push(record);
    await saveRecords(records);

    const typeLabel = params.mealType === "lunch" ? "午餐" : "晚餐";
    const foodsStr = params.foods.join("、");
    return {
      content: [
        {
          type: "text",
          text: `✅ 已记录 ${params.date} ${typeLabel}：${foodsStr}`,
        },
      ],
      details: { record },
    };
  },
});

// ── 工具 2: get_weekly_summary ──────────────────────────

const getWeeklySummary = defineTool({
  name: "get_weekly_summary",
  label: "获取周饮食汇总",
  description:
    "获取某周的饮食记录汇总。不传参则默认取本周。返回该周所有记录及统计信息。",
  parameters: Type.Object({
    year: Type.Optional(
      Type.Number({
        description: "年份，如 2026。不传则取当前周",
      }),
    ),
    week: Type.Optional(
      Type.Number({
        description: "ISO 周数（1-53）。不传则取当前周",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const today = new Date();
    const iso = getISOWeek(today);
    const targetYear = params.year ?? iso.year;
    const targetWeek = params.week ?? iso.week;

    const { start, end } = getWeekDateRange(targetYear, targetWeek);

    const allRecords = await loadRecords();
    const weekRecords = allRecords.filter((r) => r.date >= start && r.date <= end);

    // 按日期排序
    weekRecords.sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));

    // 统计
    const totalMeals = weekRecords.length;
    const lunchCount = weekRecords.filter((r) => r.mealType === "lunch").length;
    const dinnerCount = weekRecords.filter((r) => r.mealType === "dinner").length;

    // 蛋白质来源统计（常见高蛋白食物）
    const proteinKeywords = ["鸡胸", "鸡肉", "牛肉", "牛腩", "鱼", "虾", "鸡蛋", "豆腐", "豆干", "豆制品", "牛奶", "酸奶", "蛋白", "猪肉", "羊肉", "鸭"];
    const proteinCount: Record<string, number> = {};
    const vegCount: Record<string, number> = {};
    const allFoods: string[] = [];

    for (const r of weekRecords) {
      for (const f of r.foods) {
        allFoods.push(f);
        // 匹配蛋白质食材
        const matched = proteinKeywords.find((kw) => f.includes(kw));
        if (matched) {
          proteinCount[matched] = (proteinCount[matched] ?? 0) + 1;
        } else {
          // 非蛋白质食材算蔬菜/其他
          vegCount[f] = (vegCount[f] ?? 0) + 1;
        }
      }
    }

    // 格式化输出
    const lines: string[] = [];
    lines.push(`📅 ${start} ~ ${end}（第 ${targetWeek} 周）`);
    lines.push(`🍽️ 共记录 ${totalMeals} 餐（午餐 ${lunchCount} 餐，晚餐 ${dinnerCount} 餐）`);
    lines.push("");

    if (totalMeals === 0) {
      lines.push("本周还没有饮食记录哦～");
    } else {
      // 蛋白质来源分布
      const proteinEntries = Object.entries(proteinCount).sort((a, b) => b[1] - a[1]);
      if (proteinEntries.length > 0) {
        lines.push("🥩 蛋白质来源分布：");
        lines.push(
          proteinEntries.map(([name, cnt]) => `${name} x${cnt}`).join(" | "),
        );
        lines.push("");
      }

      // 蔬菜多样性
      const vegEntries = Object.entries(vegCount).sort((a, b) => b[1] - a[1]);
      if (vegEntries.length > 0) {
        lines.push("🥦 食材多样性：");
        lines.push(
          vegEntries.map(([name, cnt]) => `${name} x${cnt}`).join(" | "),
        );
        lines.push("");
      }

      // 记录规律性
      const recordedDates = new Set(weekRecords.map((r) => r.date));
      const totalDays = 7;
      const coverage = `${recordedDates.size}/${totalDays} 天有记录`;
      lines.push(`📋 记录覆盖：${coverage}`);
      lines.push("");

      // 逐日详情
      lines.push("📋 逐日详情：");
      const dateGroups: Record<string, MealRecord[]> = {};
      for (const r of weekRecords) {
        if (!dateGroups[r.date]) dateGroups[r.date] = [];
        dateGroups[r.date].push(r);
      }
      for (const [date, meals] of Object.entries(dateGroups)) {
        const mealLines = meals
          .map((m) => {
            const type = m.mealType === "lunch" ? "午餐" : "晚餐";
            return `  ${type}: ${m.foods.join("、")}`;
          })
          .join("\n");
        lines.push(`**${date}**`);
        lines.push(mealLines);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: lines.join("\n"),
        },
      ],
      details: {
        year: targetYear,
        week: targetWeek,
        start,
        end,
        totalMeals,
        records: weekRecords,
      },
    };
  },
});

// ── 注册扩展 ────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool(recordMeal);
  pi.registerTool(getWeeklySummary);
}
