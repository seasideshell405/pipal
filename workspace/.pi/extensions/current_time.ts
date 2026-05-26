/**
 * current_time — Pi 扩展：获取当前精确时间
 *
 * 注册 get_current_time 工具，返回带时区的精确日期时间。
 * 仅当 Pi 需要明确知道「现在是几点几分」时才使用。
 *
 * 使用场景示例：
 * - 用户问「现在几点了」
 * - 判断某个截止日期是否已过
 * - 日志/记录需要精确时间戳
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const getCurrentTime = defineTool({
  name: "get_current_time",
  label: "获取当前时间",
  description:
    "获取当前精确的日期和时间（北京时间，UTC+8）。" +
    "返回年月日、星期几、时分秒。",
  parameters: Type.Object({}),

  async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
    const now = new Date();

    // 北京时间 (UTC+8)
    const bjOffset = 8 * 60;
    const bjDate = new Date(now.getTime() + bjOffset * 60 * 1000);

    const year = bjDate.getUTCFullYear();
    const month = String(bjDate.getUTCMonth() + 1).padStart(2, "0");
    const day = String(bjDate.getUTCDate()).padStart(2, "0");
    const hours = String(bjDate.getUTCHours()).padStart(2, "0");
    const minutes = String(bjDate.getUTCMinutes()).padStart(2, "0");
    const seconds = String(bjDate.getUTCSeconds()).padStart(2, "0");

    const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
    const weekDay = weekDays[bjDate.getUTCDay()];

    const dateStr = `${year}-${month}-${day}`;
    const timeStr = `${hours}:${minutes}:${seconds}`;
    const weekStr = `星期${weekDay}`;

    return {
      content: [
        {
          type: "text",
          text: `当前时间：${dateStr} ${weekStr} ${timeStr}（北京时间，UTC+8）`,
        },
      ],
      details: {
        date: dateStr,
        time: timeStr,
        weekday: weekStr,
        timestamp: now.toISOString(),
        timezone: "Asia/Shanghai (UTC+8)",
      },
    };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(getCurrentTime);
}
