/**
 * 市场行情查询扩展
 *
 * 注册 `get_market_quotes` 工具，直接对接金融数据API，
 * 返回带精确时间戳的实时行情数据。
 *
 * 数据源：
 * - 中证500 → 腾讯行情 API（国内稳定）
 * - 黄金(RMB) → 新浪国际金价 + 汇率换算
 * - 日经225 / KOSPI → 雅虎财经 API（通过 curl 走代理）
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { exec } from "node:child_process";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

interface QuoteResult {
  /** 品种名称 */
  name: string;
  /** 最新价格 */
  price: number;
  /** 涨跌额 */
  change: number;
  /** 涨跌幅（百分比） */
  changePercent: number;
  /** 昨收价 */
  previousClose: number;
  /** 数据时间（北京时间） */
  time: string;
  /** 数据来源说明 */
  source: string;
}

interface ApiQuote {
  name: string;
  price: number;
  previousClose: number;
  time: string;
  source: string;
}

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

/** 保留指定位数小数 */
function toFixed(n: number, digits: number): number {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

/** 通过 curl 获取 JSON（用于需要走代理的海外API） */
function curlFetch(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `curl -s "${url}" -H "User-Agent: Mozilla/5.0" -m 15`,
      { maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`curl 请求失败: ${err.message}`));
        if (!stdout) return reject(new Error("curl 返回为空"));
        resolve(stdout);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// 各品种数据获取函数
// ---------------------------------------------------------------------------

/** 获取中证500实时行情（腾讯行情API） */
async function fetchCSI500(): Promise<ApiQuote> {
  const url = "https://qt.gtimg.cn/q=sh000905";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`中证500 API 请求失败: ${res.status}`);
  const text = await res.text();

  // 腾讯格式: v_sh000905="1~中证500~000905~8658.62~8703.89~8665.44~...~20260526161409~-45.27~-0.52~..."
  const match = text.match(/"([^"]+)"/);
  if (!match) throw new Error("无法解析中证500数据");

  const parts = match[1].split("~");
  const price = parseFloat(parts[3]); // 当前价
  const prevClose = parseFloat(parts[4]); // 昨收
  const changePercent = parseFloat(parts[32]); // 涨跌幅
  const timeRaw = parts[30]; // 时间戳 YYYYMMDDHHMMSS

  const timeStr = timeRaw
    ? `${timeRaw.slice(8, 10)}:${timeRaw.slice(10, 12)}:${timeRaw.slice(12, 14)}`
    : "--:--:--";

  return {
    name: "中证500",
    price,
    previousClose: prevClose,
    time: timeStr,
    source: "腾讯行情",
  };
}

/** 获取黄金人民币价格（上海黄金交易所 Au99.99 实时行情） */
async function fetchGoldRMB(): Promise<ApiQuote> {
  // 从上海黄金交易所官网获取延时行情
  const res = await fetch("https://www.sge.com.cn/sjzx/yshqbg", {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!res.ok) throw new Error(`SGE API 请求失败: ${res.status}`);
  const html = await res.text();

  // 解析表格，找到 Au99.99 行
  const tableMatch = html.match(/<table[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) throw new Error("无法解析SGE表格");

  // 按行分割
  const rows = tableMatch[1].split(/<tr[^>]*>/);
  let price = 0;
  let prevClose = 0;

  for (const row of rows) {
    if (!row.includes("Au99.99")) continue;
    const cells = row.split(/<td[^>]*>/);
    const cleanCells: string[] = [];
    for (const c of cells) {
      const val = c.replace(/<[^>]+>/g, "").trim();
      if (val && !isNaN(parseFloat(val))) {
        cleanCells.push(val);
      }
    }
    // cleanCells: [最新价, 最高, 最低, 昨收盘]
    if (cleanCells.length >= 4) {
      price = parseFloat(cleanCells[0]);
      prevClose = parseFloat(cleanCells[3]);
    }
    break;
  }

  if (!price || !prevClose) throw new Error("无法解析Au99.99数据");

  // 数据时间为页面生成时间
  const timeMatch = html.match(/STime:\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/);
  const timeStr = timeMatch
    ? timeMatch[1].split(/\s+/)[1].slice(0, 5)
    : "--:--";

  return {
    name: "黄金(RMB)",
    price,
    previousClose: prevClose,
    time: timeStr,
    source: "上海黄金交易所（Au99.99）",
  };
}

/** 获取日经225收盘行情（雅虎财经API，通过curl走代理） */
async function fetchNikkei225(): Promise<ApiQuote> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EN225?range=1d&interval=1d";
  const text = await curlFetch(url);
  const body = JSON.parse(text);
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("无法解析日经225数据");

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose;

  // 雅虎返回的是 Unix 时间戳（秒），转换为北京时间（UTC+8）
  const ts = meta.regularMarketTime as number;
  const d = new Date((ts as number) * 1000);
  const bjOffset = 8 * 60; // 北京时间比UTC早8小时
  const bjDate = new Date(d.getTime() + bjOffset * 60 * 1000);
  const timeStr = `${String(bjDate.getUTCHours()).padStart(2, "0")}:${String(bjDate.getUTCMinutes()).padStart(2, "0")}`;

  return {
    name: "日经225",
    price,
    previousClose: prevClose,
    time: timeStr,
    source: "雅虎财经",
  };
}

/** 获取KOSPI收盘行情（雅虎财经API，通过curl走代理） */
async function fetchKOSPI(): Promise<ApiQuote> {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/%5EKS11?range=1d&interval=1d";
  const text = await curlFetch(url);
  const body = JSON.parse(text);
  const meta = body?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("无法解析KOSPI数据");

  const price = meta.regularMarketPrice;
  const prevClose = meta.chartPreviousClose;

  const ts = meta.regularMarketTime as number;
  const d = new Date((ts as number) * 1000);
  const bjOffset = 8 * 60;
  const bjDate = new Date(d.getTime() + bjOffset * 60 * 1000);
  const timeStr = `${String(bjDate.getUTCHours()).padStart(2, "0")}:${String(bjDate.getUTCMinutes()).padStart(2, "0")}`;

  return {
    name: "KOSPI",
    price,
    previousClose: prevClose,
    time: timeStr,
    source: "雅虎财经",
  };
}

// ---------------------------------------------------------------------------
// 品种名称到获取函数的映射
// ---------------------------------------------------------------------------

const FETCHERS: Record<string, () => Promise<ApiQuote>> = {
  "黄金": fetchGoldRMB,
  "黄金(RMB)": fetchGoldRMB,
  "gold": fetchGoldRMB,
  "中证500": fetchCSI500,
  "csi500": fetchCSI500,
  "日经225": fetchNikkei225,
  "日经": fetchNikkei225,
  "nikkei": fetchNikkei225,
  "n225": fetchNikkei225,
  "KOSPI": fetchKOSPI,
  "kospi": fetchKOSPI,
  "韩国综指": fetchKOSPI,
};

// ---------------------------------------------------------------------------
// 扩展入口
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "get_market_quotes",
    label: "行情查询",
    description:
      "获取指定品种的实时/收盘行情数据，返回带精确时间戳的价格、涨跌幅等信息。支持品种：黄金(RMB)、中证500、日经225、KOSPI。可同时查询多个品种。",
    promptSnippet: "获取实时行情数据",
    promptGuidelines: [
      "查询行情时优先使用此工具，返回的数据带精确时间戳，比网页搜索更准确。",
      "可同时查询多个品种，传入数组即可。",
    ],
    parameters: Type.Object({
      symbols: Type.Array(
        Type.String({
          description: "品种名称，支持：黄金(RMB)、中证500、日经225、KOSPI",
        }),
        {
          description: "要查询的品种列表，例如 [\"中证500\", \"日经225\"]",
        },
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const symbols: string[] = params.symbols;
      if (!symbols || symbols.length === 0) {
        return {
          content: [{ type: "text", text: "请指定要查询的品种，例如：[\"中证500\", \"日经225\", \"KOSPI\"]" }],
        };
      }

      const results: QuoteResult[] = [];
      const errors: string[] = [];

      for (const sym of symbols) {
        const fetcher = FETCHERS[sym];
        if (!fetcher) {
          errors.push(`${sym}: 不支持该品种`);
          continue;
        }

        try {
          const quote = await fetcher();
          const change = toFixed(quote.price - quote.previousClose, 2);
          const changePercent = toFixed((change / quote.previousClose) * 100, 2);

          results.push({
            name: quote.name,
            price: toFixed(quote.price, 2),
            change,
            changePercent,
            previousClose: toFixed(quote.previousClose, 2),
            time: quote.time,
            source: quote.source,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${sym}: ${msg}`);
        }
      }

      // 构建返回文本
      const lines: string[] = [];
      if (results.length > 0) {
        lines.push("## 行情数据");
        lines.push("");
        lines.push("| 品种 | 价格 | 涨跌额 | 涨跌幅 | 数据时间 | 来源 |");
        lines.push("|------|------|--------|--------|----------|------|");
        for (const r of results) {
          const arrow = r.change >= 0 ? "↑" : "↓";
          lines.push(
            `| ${r.name} | ${r.price} | ${r.change >= 0 ? "+" : ""}${r.change} ${arrow} | ${r.changePercent >= 0 ? "+" : ""}${r.changePercent}% | ${r.time} | ${r.source} |`,
          );
        }
      }
      if (errors.length > 0) {
        lines.push("");
        lines.push("### 查询失败的品种");
        for (const e of errors) {
          lines.push(`- ${e}`);
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { results, errors },
      };
    },
  });
}
