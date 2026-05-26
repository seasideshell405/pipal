/**
 * get_raw_conversation — Pi 扩展
 *
 * 允许 Pi 查询某天指定时间段内的原始对话记录。
 * 读取 data/archives/YYYY-MM-DD.jsonl，按北京时间筛选时间段。
 * 兼容 UTC ISO 格式（带 Z 后缀）和北京时间格式的时间戳。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? "./data";

/** 将时间戳转成北京时间分钟数（00:00=0, 23:59=1439） */
function toBeijingMinutes(ts: string): number {
  if (ts.endsWith("Z")) {
    // UTC ISO: "2026-05-25T15:08:34.975Z"
    const d = new Date(ts);
    const bjHours = (d.getUTCHours() + 8) % 24;
    return bjHours * 60 + d.getUTCMinutes();
  }
  // 北京时间格式: "2026-05-26 01:00:00"
  const timePart = ts.includes("T") ? ts.split("T")[1] : ts.split(" ")[1];
  const [h, m] = timePart.split(":").map(Number);
  return h * 60 + m;
}

const archivalTool = defineTool({
  name: "get_raw_conversation",
  label: "获取原始对话",
  description:
    "查询某天指定时间段内的原始对话记录。参数 date 为日期（YYYY-MM-DD），start_time 和 end_time 为北京时间起止时间（HH:mm）。",
  parameters: Type.Object({
    date: Type.String({ description: "日期，格式 YYYY-MM-DD" }),
    start_time: Type.String({ description: "起始时间（北京时间），格式 HH:mm" }),
    end_time: Type.String({ description: "结束时间（北京时间），格式 HH:mm" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const [startH, startM] = params.start_time.split(":").map(Number);
    const [endH, endM] = params.end_time.split(":").map(Number);
    const startMin = startH * 60 + startM;
    const endMin = endH * 60 + endM;

    const filePath = path.resolve(DATA_DIR, "archives", `${params.date}.jsonl`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const entries = content
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line: string) => JSON.parse(line))
        .filter((entry: any) => {
          const min = toBeijingMinutes(entry.timestamp);
          return min >= startMin && min <= endMin;
        });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              date: params.date,
              start_time: params.start_time,
              end_time: params.end_time,
              entries,
            }),
          },
        ],
        details: undefined,
      };
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as any).code === "ENOENT") {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                date: params.date,
                start_time: params.start_time,
                end_time: params.end_time,
                entries: [],
              }),
            },
          ],
          details: undefined,
        };
      }
      throw err;
    }
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(archivalTool);
}
