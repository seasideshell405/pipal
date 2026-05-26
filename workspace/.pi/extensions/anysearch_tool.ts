/**
 * anysearch_tool — Pi 扩展
 *
 * 注册 search / list_domains / extract / batch_search 四个工具，
 * 让 Pi 通过 AnySearch API 获取实时信息、提取网页内容、查询垂直领域。
 *
 * 使用 JSON-RPC 2.0 协议：https://api.anysearch.com/mcp
 * 支持匿名模式（无需 API Key）和认证模式（ANYSEARCH_API_KEY）。
 *
 * API 文档: https://www.anysearch.com/docs
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const API_ENDPOINT = "https://api.anysearch.com/mcp";

/** JSON-RPC 调用封装 */
async function callTool(
  toolName: string,
  arguments_: Record<string, unknown>,
): Promise<string> {
  const apiKey = process.env.ANYSEARCH_API_KEY;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: toolName, arguments: arguments_ },
  };

  let response: Response;
  try {
    response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return `请求失败: ${err instanceof Error ? err.message : String(err)}`;
  }

  const data = await response.json().catch(() => ({}));

  if (data.error) {
    return `API 错误: ${data.error.message ?? JSON.stringify(data.error)}`;
  }

  const content = data?.result?.content ?? [];
  for (const item of content) {
    if (item.type === "text" && item.text) {
      return item.text;
    }
  }

  return JSON.stringify(data.result ?? {}, null, 2);
}

// ── search ──

const searchTool = defineTool({
  name: "search",
  label: "搜索互联网",
  description:
    "通过 AnySearch 搜索引擎检索实时互联网信息。适合查询新闻、技术文档、事实信息等需要联网获取的内容。支持通用搜索和垂直领域搜索（如金融、学术、代码等）。进行垂直搜索前应先调用 list_domains 查看可用 sub_domain。",
  parameters: Type.Object({
    query: Type.String({ description: "搜索关键词" }),
    max_results: Type.Optional(
      Type.Number({ description: "返回结果数量，默认 5，范围 1–20" }),
    ),
    domain: Type.Optional(
      Type.String({
        description:
          "垂直领域，例如 finance（金融）、academic（学术）、code（代码）、health（健康）等。使用前先调 list_domains 查看可用领域和 sub_domain",
      }),
    ),
    sub_domain: Type.Optional(
      Type.String({
        description:
          "子领域路由键（如 finance.us_stock），垂直搜索时必填，通过 list_domains 获取",
      }),
    ),
    content_types: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "内容类型过滤，可选值: web（网页）、news（新闻）、code（代码）、doc（文档）、academic（学术）、image（图片）、video（视频）",
      }),
    ),
    zone: Type.Optional(
      Type.String({
        description: "区域: cn（中国）或 intl（国际），list_domains 标记为 CN 时必填",
      }),
    ),
    freshness: Type.Optional(
      Type.String({
        description:
          "时间范围过滤：day（一天内）、week（一周内）、month（一月内）、year（一年内）",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const args: Record<string, unknown> = { query: params.query };
    if (params.max_results) args.max_results = Math.min(params.max_results, 20);
    if (params.domain) args.domain = params.domain;
    if (params.sub_domain) args.sub_domain = params.sub_domain;
    if (params.content_types) args.content_types = params.content_types;
    if (params.zone) args.zone = params.zone;
    if (params.freshness) args.freshness = params.freshness;

    const text = await callTool("search", args);
    return { content: [{ type: "text", text }], details: undefined };
  },
});

// ── list_domains ──

const listDomainsTool = defineTool({
  name: "list_domains",
  label: "查询垂直领域",
  description:
    "查询 AnySearch 支持的垂直领域及其子领域、查询格式和参数 schema。进行垂直搜索前必须先调用此工具获取正确的 sub_domain 和 query_format。",
  parameters: Type.Object({
    domain: Type.Optional(
      Type.String({
        description: "单个领域，例如 finance、academic、code、health、legal、news 等",
      }),
    ),
    domains: Type.Optional(
      Type.Array(Type.String(), {
        description: "批量查询最多 5 个领域，优先级高于 domain",
      }),
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const args: Record<string, unknown> = {};
    if (params.domains) args.domains = params.domains;
    else if (params.domain) args.domain = params.domain;

    const text = await callTool("list_domains", args);
    return { content: [{ type: "text", text }], details: undefined };
  },
});

// ── extract ──

const extractTool = defineTool({
  name: "extract",
  label: "提取网页内容",
  description:
    "提取指定 URL 的完整页面内容并返回为 Markdown 格式。适合搜索结果摘要不足以满足需求时，深入读取文章、文档或数据。仅支持 HTML 页面，输出截断至 50,000 字符。",
  parameters: Type.Object({
    url: Type.String({ description: "目标 URL，必须以 http:// 或 https:// 开头" }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const text = await callTool("extract", { url: params.url });
    return { content: [{ type: "text", text }], details: undefined };
  },
});

// ── batch_search ──

const batchSearchTool = defineTool({
  name: "batch_search",
  label: "批量搜索",
  description:
    "同时执行 2–5 条独立的搜索查询，结果合并返回。每条查询支持 search 工具的所有参数（query、domain、sub_domain、content_types、zone、max_results、freshness）。单条失败不影响其他查询。",
  parameters: Type.Object({
    queries: Type.Array(
      Type.Object({
        query: Type.String({ description: "搜索关键词" }),
        max_results: Type.Optional(Type.Number()),
        domain: Type.Optional(Type.String()),
        sub_domain: Type.Optional(Type.String()),
        content_types: Type.Optional(Type.Array(Type.String())),
        zone: Type.Optional(Type.String()),
        freshness: Type.Optional(Type.String()),
      }),
      { description: "搜索查询数组，2–5 条" },
    ),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const text = await callTool("batch_search", {
      queries: params.queries,
    });
    return { content: [{ type: "text", text }], details: undefined };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(searchTool);
  pi.registerTool(listDomainsTool);
  pi.registerTool(extractTool);
  pi.registerTool(batchSearchTool);
}
