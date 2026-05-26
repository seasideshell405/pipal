import { join } from 'node:path';
import { formatDate } from './date-utils.js';
import type { LLMConfig } from './types.js';

/**
 * 底层 Pi SDK 会话封装
 *
 * 使用动态 import 加载 ESM-only 的 Pi SDK，避免 CJS/ESM 兼容问题。
 * 测试时通过 IPiSessionFactory mock 此模块。
 */
export interface IPiSession {
  /** 发送消息并等待回复文本 */
  prompt(text: string): Promise<string>;
  /** 是否正在处理中 */
  readonly isProcessing: boolean;
  /** 获取 Pi SDK 组装后的系统提示词文本 */
  getSystemPrompt(): string;
  /** 估算当前上下文输入 token 数 */
  getEstimatedInputTokens(): number;
  /** 获取当前路径上的消息条数（用户 + 助理） */
  getPathMessageCount(): number;
  /** 运行时切换系统提示词 */
  setSystemPrompt(prompt: string): void;
  /** 获取所有已注册的工具信息 */
  getAllTools(): Array<{ name: string; description: string }>;
  /** 获取当前活跃的工具名称列表 */
  getActiveToolNames(): string[];
  /** 设置当前活跃的工具 */
  setActiveToolsByName(names: string[]): void;
  /** 获取当前会话的显示名称（Pi 自动生成或用户设定） */
  getSessionName(): string | undefined;
  /** 设置当前会话的显示名称 */
  setSessionName(name: string): void;
  /** 获取当前会话最后一轮的用户消息条目 ID，用作 checkpoint */
  getCheckpointEntryId(): string | null;
  /** 获取所有可作为回滚目标的对话节点列表 */
  getForkPoints(): Array<{ entryId: string; content: string }>;
  /** 获取当前路径上紧接在指定 entryId 之后的下一条记录 ID（用于补偿 Pi SDK navigateTree 的 parentId 回退逻辑） */
  getNextEntryId(entryId: string): string | null;
  /** 导航到指定的条目，可选择总结被废弃的分支 */
  navigateToEntry(entryId: string, options?: { summarize?: boolean }): Promise<void>;
  /** 中断当前正在执行的 prompt */
  stop(): Promise<void>;
  /** 处理完毕后清理 */
  dispose(): void;
  /** 累计消耗的 token 总数 */
  readonly totalTokens: number;
}

export interface IPiSessionFactory {
  create(config: {
    llm: LLMConfig;
    systemPrompt?: string;
    workspaceDir?: string;
    /** 是否启用全部工具（包括内置工具）。默认 false，禁用内置工具。 */
    enableAllTools?: boolean;
    /** Pi 专属 agent 目录（存放扩展、技能），不传则用全局 ~/.pi/agent */
    agentDir?: string;
    /** 自定义 session 文件路径，不传则默认 data/sessions/YYYY-MM-DD.jsonl */
    sessionPath?: string;
  }): Promise<IPiSession>;
}

/**
 * 生产环境的 PiSessionFactory
 * 使用动态 import 加载 @earendil-works/pi-coding-agent
 */
export class PiSessionFactory implements IPiSessionFactory {
  async create(options: {
    llm: LLMConfig;
    systemPrompt?: string;
    workspaceDir?: string;
    enableAllTools?: boolean;
    agentDir?: string;
    sessionPath?: string;
  }): Promise<IPiSession> {
    // 动态加载 ESM-only Pi SDK
    const pi = await importPiSdk();

    const { AuthStorage, ModelRegistry, SessionManager, DefaultResourceLoader, getAgentDir } = pi;

    const auth = AuthStorage.create();
    auth.setRuntimeApiKey(options.llm.provider, options.llm.apiKey);

    const registry = ModelRegistry.create(auth);
    let model = registry.find(options.llm.provider, options.llm.model);
    if (!model) {
      // 配置的模型名与 Pi SDK 内置 ID 不一致时，兜底取该 provider 的第一个可用模型
      const providerModels = registry.getAll().filter((m: any) => m.provider === options.llm.provider);
      model = providerModels[0] ?? null;
      if (!model) {
        throw new Error(`找不到模型: ${options.llm.provider}/${options.llm.model}，且该提供商下无可用模型`);
      }
    }

    const workspaceDir = options.workspaceDir ?? process.cwd();

    // 会话文件路径：自定义路径（如 sudo 会话）或默认 data/sessions/YYYY-MM-DD.jsonl
    const sessionPath = options.sessionPath ?? join(process.cwd(), 'data/sessions', `${formatDate(new Date())}.jsonl`);
    const sessionMgr = SessionManager.open(sessionPath);

    // ResourceLoader: 加载 Pi 扩展、技能、提示词模板
    // cwd 指向 workspace，让 Pi 作为一个独立环境运行
    const resourceLoader = new DefaultResourceLoader({
      cwd: workspaceDir,
      agentDir: options.agentDir ?? getAgentDir(),
      systemPrompt: options.systemPrompt ?? '',
      noThemes: true,
      noContextFiles: true,
      skillsOverride: (base: any) => ({
        ...base,
        skills: base.skills.filter((s: any) => !s.filePath.includes('.agents')),
      }),
    });
    await resourceLoader.reload();

    const { session } = await pi.createAgentSession({
      model,
      modelRegistry: registry,
      sessionManager: sessionMgr,
      authStorage: auth,
      resourceLoader,
      cwd: workspaceDir,
      noTools: options.enableAllTools ? undefined : "builtin",
    });

    // 普通模式：只保留扩展注册的工具，屏蔽 Pi SDK 内置工具
    if (!options.enableAllTools) {
      const builtin = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls']);
      const all = (session.getAllTools() ?? []).map((t: any) => t.name);
      const active = all.filter((n: string) => !builtin.has(n));
      session.setActiveToolsByName(active);
    }

    return new PiSession(session);
  }
}

class PiSession implements IPiSession {
  private session: Awaited<ReturnType<typeof importPiSdk>>['AgentSession'] | null;
  private _processing: boolean = false;
  private _totalTokens: number = 0;
  private disposePromise?: Promise<void>;

  constructor(session: any) {
    this.session = session;
  }

  async prompt(text: string): Promise<string> {
    const session = this.session;
    if (!session) throw new Error('会话已关闭');

    this._processing = true;

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this._processing = false;
        await this.session?.abort();
        reject(new Error('LLM 响应超时'));
      }, 600_000);

      const unsubscribe = session.subscribe((event: any) => {
        if (event.type === 'agent_end') {
          unsubscribe();
          this._processing = false;
          const msgs = event.messages || [];
          const lastAssistant = msgs.filter((m: any) => m.role === 'assistant').pop();
          const text = lastAssistant?.content
            ?.filter((c: any) => c.type === 'text')
            .map((c: any) => c.text)
            .join('') ?? '';
          if (lastAssistant?.usage?.totalTokens) {
            this._totalTokens += lastAssistant.usage.totalTokens;
          }
          resolve(text);
        }
      });

      session.prompt(text).catch((err: unknown) => {
        unsubscribe();
        this._processing = false;
        reject(err);
      });
    });
  }

  get isProcessing(): boolean {
    return this._processing;
  }

  get totalTokens(): number {
    return this._totalTokens;
  }

  getSystemPrompt(): string {
    return this.session?.systemPrompt ?? '';
  }

  setSystemPrompt(prompt: string): void {
    if (this.session) {
      this.session.systemPrompt = prompt;
    }
  }

  getAllTools(): Array<{ name: string; description: string }> {
    if (!this.session) return [];
    try {
      return this.session.getAllTools().map((t: any) => ({
        name: t.name,
        description: t.description ?? '',
      }));
    } catch {
      return [];
    }
  }

  getActiveToolNames(): string[] {
    if (!this.session) return [];
    try {
      return this.session.getActiveToolNames();
    } catch {
      return [];
    }
  }

  setActiveToolsByName(names: string[]): void {
    this.session?.setActiveToolsByName(names);
  }

  getSessionName(): string | undefined {
    return this.session?.sessionName;
  }

  setSessionName(name: string): void {
    this.session?.setSessionName(name);
  }

  getCheckpointEntryId(): string | null {
    if (!this.session) return null;
    try {
      const msgs = this.session.getUserMessagesForForking();
      return msgs.length > 0 ? msgs[msgs.length - 1].entryId : null;
    } catch {
      return null;
    }
  }

  getForkPoints(): Array<{ entryId: string; content: string }> {
    return this._getPathUserMessages();
  }

  /** 上次请求的实际输入 token 数（从 session 文件读取，重启不丢失） */
  getEstimatedInputTokens(): number {
    if (!this.session) return 0;
    try {
      const sm = (this.session as any).sessionManager;
      if (!sm) return 0;

      const pathIds = this._buildPathIds(sm);
      const entries = sm.getEntries();

      // 从当前路径上找最后一条有 usage.totalTokens 的 assistant 消息
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (!pathIds.has(entry.id)) continue;
        if (entry.type !== 'message') continue;
        if (entry.message?.role !== 'assistant') continue;
        const tt = entry.message?.usage?.totalTokens;
        if (typeof tt === 'number' && tt > 0) {
          return tt;
        }
      }
      return 0;
    } catch {
      return 0;
    }
  }

  /** 当前路径上的用户消息条数（从 session 读取，重启不丢失） */
  getPathMessageCount(): number {
    if (!this.session) return 0;
    try {
      const sm = (this.session as any).sessionManager;
      if (!sm) return 0;

      const pathIds = this._buildPathIds(sm);
      const entries = sm.getEntries();

      let count = 0;
      for (const entry of entries) {
        if (!pathIds.has(entry.id)) continue;
        if (entry.type !== 'message') continue;
        if (entry.message?.role === 'user') {
          count++;
        }
      }
      return count;
    } catch {
      return 0;
    }
  }

  getNextEntryId(entryId: string): string | null {
    if (!this.session) return null;
    try {
      const sm = (this.session as any).sessionManager;
      if (!sm) return null;
      const pathIds = this._buildPathIds(sm);
      const entries = sm.getEntries();
      const next = entries.find(
        (e: any) => e.parentId === entryId && pathIds.has(e.id)
      );
      return next?.id ?? null;
    } catch {
      return null;
    }
  }

  /** 从 leafId 沿 parentId 走到根，收集当前路径上的 entryId */
  private _buildPathIds(sm: any): Set<string> {
    const pathIds = new Set<string>();
    const leafId: string | null = sm.leafId;
    if (!leafId) return pathIds;
    let current = sm.byId.get(leafId);
    while (current) {
      pathIds.add(current.id);
      current = current.parentId ? sm.byId.get(current.parentId) : undefined;
    }
    return pathIds;
  }

  /** 获取当前路径上的所有用户消息 */
  private _getPathUserMessages(): Array<{ entryId: string; content: string }> {
    if (!this.session) return [];
    try {
      const sm = (this.session as any).sessionManager;
      if (!sm) return [];

      const pathIds = this._buildPathIds(sm);

      // 只保留当前路径上的用户消息
      const entries = sm.getEntries();
      const result: Array<{ entryId: string; content: string }> = [];
      for (const entry of entries) {
        if (entry.type !== 'message') continue;
        if (entry.message.role !== 'user') continue;
        if (!pathIds.has(entry.id)) continue;
        const text = extractUserMessageText(entry.message.content);
        if (text) {
          result.push({ entryId: entry.id, content: text });
        }
      }
      return result;
    } catch {
      return [];
    }
  }

  async navigateToEntry(entryId: string, options?: { summarize?: boolean }): Promise<void> {
    await this.session?.navigateTree(entryId, { summarize: options?.summarize ?? false });
  }

  async stop(): Promise<void> {
    this._processing = false;
    await this.session?.abort();
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }
}

/** 从 Pi SDK 消息 content 中提取文本（兼容 string 和 TextContent 数组） */
function extractUserMessageText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('');
  }
  return '';
}

// 缓存动态导入结果，避免重复加载
let piSdkPromise: Promise<any> | null = null;

async function importPiSdk() {
  if (!piSdkPromise) {
    piSdkPromise = import('@earendil-works/pi-coding-agent');
  }
  return piSdkPromise;
}

