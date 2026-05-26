import type { IPiSession, IPiSessionFactory } from './pi-session.js';
import type { LLMConfig } from './types.js';
import type { Logger } from './logger.js';
import { loadMemoryContext } from './memory/index.js';
import { createArchive, type Archive } from './memory/archival.js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { formatDate, formatTs } from './date-utils.js';
import { getPromptsDir } from './prompt-dir.js';

export interface SudoSessionMeta {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionConfig {
  llm: LLMConfig;
  dataDir: string;
  piFactory: IPiSessionFactory;
  workspaceDir?: string;
  logger?: Logger;
}

export class SessionManager {
  private _currentSession: IPiSession | null = null;
  private _currentSystemPrompt: string = '';
  private _currentDate: string = '';
  private config: SessionConfig;
  private archive: Archive;
  private log: Logger;
  /** sudo 模式下保存的正常会话，exit 后恢复 */
  private _savedNormalSession: IPiSession | null = null;
  /** sudo 模式下保存的 _currentDate */
  private _savedNormalDate: string = '';
  /** 当前激活的 sudo 会话 ID（null = 不在 sudo 模式） */
  private _activeSudoSessionId: string | null = null;
  /** sudo 会话目录 */
  private _sudoSessionsDir: string;

  constructor(config: SessionConfig) {
    this.config = config;
    this.archive = createArchive(`${config.dataDir}/archives`);
    this._sudoSessionsDir = join(config.dataDir, 'sessions', 'sudo');
    this.log = config.logger ?? { debug: console.log, info: console.log, warn: console.warn, error: console.error } as Logger;
  }

  get currentSession(): IPiSession | null {
    return this._currentSession;
  }

  get isProcessing(): boolean {
    return this._currentSession?.isProcessing ?? false;
  }

  get currentDate(): string {
    return this._currentDate;
  }

  getSystemPrompt(): string {
    if (this._currentSession) {
      return this._currentSession.getSystemPrompt();
    }
    return this._currentSystemPrompt;
  }

  getTools(): Array<{ name: string; description: string }> {
    if (!this._currentSession) return [];
    return this._currentSession.getAllTools();
  }

  getActiveToolNames(): string[] {
    if (!this._currentSession) return [];
    return this._currentSession.getActiveToolNames();
  }

  getArchive(): Archive {
    return this.archive;
  }

  /** 获取所有可回滚的对话节点 */
  getForkPoints(): Array<{ entryId: string; content: string }> {
    return this._currentSession?.getForkPoints() ?? [];
  }

  /** 估算当前上下文输入 token 数 */
  getEstimatedInputTokens(): number {
    return this._currentSession?.getEstimatedInputTokens() ?? 0;
  }

  /** 当前路径上的消息条数（从 session 读取，重启不丢失） */
  getPathMessageCount(): number {
    return this._currentSession?.getPathMessageCount() ?? 0;
  }

  /** 回滚到指定对话节点，该节点之后的对话被总结并折叠 */
  async rollbackTo(entryId: string): Promise<void> {
    const session = this._currentSession;
    if (!session) throw new Error('没有活跃的 session');
    if (session.isProcessing) {
      await session.stop();
    }
    // Pi SDK 的 navigateTree 对用户消息特殊处理：newLeafId = target.parentId，
    // 导致目标用户消息本身被排除。改为定位到目标的下一条记录（助理回复），
    // SDK 的 parentId 回退逻辑正好让 leaf 落在我们想保留的目标用户消息上。
    const nextId = session.getNextEntryId(entryId);
    const targetId = nextId ?? entryId;
    await session.navigateToEntry(targetId, { summarize: true });
  }

  /** 删除最后一轮对话（用户消息 + 助理回复），从 session 和 archive 中移除 */
  async deleteLastExchange(): Promise<string | null> {
    const session = this._currentSession;
    if (!session) return null;

    const points = session.getForkPoints();
    if (points.length < 2) return null;

    const targetPoint = points[points.length - 2];
    const nextId = session.getNextEntryId(targetPoint.entryId);
    const targetId = nextId ?? targetPoint.entryId;
    await session.navigateToEntry(targetId, { summarize: false });

    // 从 archive 中移除最后 2 条（user + assistant）
    const today = formatDate(new Date());
    await this.archive.popLast(today, 2);

    return points[points.length - 1].content;
  }

  /**
   * 确保当前 session 是最新的。
   * 如果日期已变更，自动轮换（仅在普通模式下）。
   */
  async ensureSession(): Promise<IPiSession> {
    // sudo 模式不做日期轮换
    if (this._activeSudoSessionId) {
      return this._currentSession!;
    }
    const today = this.formatDate(new Date());
    if (!this._currentSession || this._currentDate !== today) {
      await this.rotate();
    }
    return this._currentSession!;
  }

  /**
   * 轮换 session：关闭旧的，创建新的（仅用于普通模式）
   */
  async rotate(): Promise<void> {
    const oldSession = this._currentSession;
    this._currentSession = null;

    if (oldSession) {
      oldSession.dispose();
    }

    const today = this.formatDate(new Date());
    this._currentDate = today;

    const memoryCtx = await loadMemoryContext({ dataDir: this.config.dataDir });
    const prompts = await this.loadOrGeneratePrompts(memoryCtx);
    this._currentSystemPrompt = prompts.normal;

    this._currentSession = await this.config.piFactory.create({
      llm: this.config.llm,
      systemPrompt: prompts.normal,
      workspaceDir: this.config.workspaceDir,
      agentDir: join(this.config.workspaceDir ?? process.cwd(), '.pi'),
    });
  }

  /**
   * 处理用户消息：先存档，再交给 LLM
   */
  async processMessage(userId: string, text: string): Promise<string | null> {
    const session = await this.ensureSession();

    // 存档用户消息（sudo 模式不记录）
    if (!this.isSudoMode) {
      await this.archive.append({
        role: 'user',
        content: text,
        timestamp: formatTs(new Date()),
      });
    }

    // 发送给 LLM
    try {
      const reply = await session.prompt(text);
      // 存档回复（sudo 模式不记录）
      let finalReply = reply;
      if (reply) {
        if (!this.isSudoMode) {
          await this.archive.append({
            role: 'assistant',
            content: reply,
            timestamp: formatTs(new Date()),
          });
        }
        // sudo 模式下追加模式提示
        if (this.isSudoMode) {
          finalReply = reply + '\n\n---\n*当前处于开发者模式，发送 `/exit` 退出*';
        }
      }
      return finalReply;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return null; // 被 stop 打断，不回复
      }
      throw err;
    }
  }

  /** 打断当前 Pi 的执行 */
  async stop(): Promise<void> {
    await this._currentSession?.stop();
  }

  /**
   * 从 src/prompts/（构建后为 dist/prompts/）加载提示词模板。
   * 文件不存在时使用内联兜底，用户可编辑 src/prompts/*.md 自定义。
   */
  private async loadOrGeneratePrompts(memoryCtx: {
    shortTerm: string[];
    mediumTerm: string[];
    permanent: string[];
  }): Promise<{ normal: string; sudo: string }> {
    const promptDir = getPromptsDir();

    let normalBase: string;
    try {
      normalBase = readFileSync(join(promptDir, 'normal.md'), 'utf-8');
    } catch {
      normalBase = [
        '你是 PiPal，基于 Pi SDK 二次开发的 AI 助理。',
        '',
        '## 行为准则',
        '',
        '### 语气与风格',
        '- 用**温暖自然**的语气交流，像朋友一样亲切，但保持专业',
        '- 回复**简洁**，分点清晰，避免冗长',
        '- 用户使用简体中文，你也要用简体中文回复',
        '',
        '### 回复结构',
        '- 默认用 Markdown 格式组织回复，善用分段、粗体、列表',
        '- 涉及步骤或多项内容时用有序或无序列表',
        '- 给出代码或结构化数据时用代码块',
        '',
        '### 主动性',
        '- 当用户表达需求但信息不足时，主动追问关键细节',
        '- 如果你发现可以帮用户自动化的任务（如定时提醒、例行任务），主动建议',
        '- 当用户分享重要个人信息时，主动询问是否需要永久记住',
        '- 不确定时如实说，不要编造事实',
        '',
      ].join('\n');
    }

    let sudoBase: string;
    try {
      sudoBase = readFileSync(join(promptDir, 'sudo.md'), 'utf-8');
    } catch {
      sudoBase = [
        '你是 PiPal，基于 Pi SDK 二次开发的 AI 助理，当前处于**开发者模式**。',
        '',
        '## 你的工作区',
        `你的专属工作区在 \`${this.config.workspaceDir ?? process.cwd()}\`，你可以在这里自由发挥：`,
        '- 创建、编辑、删除文件',
        '- 运行命令、安装依赖、调试代码和项目',
        '- 编写和注册 Pi SDK 扩展（\`workspace/.pi/extensions/\`）',
        '',
        '## 功能拓展流程',
        '当用户提出功能拓展需求时，按以下流程执行：',
        '',
        '1. **学习参考** — 查阅 Pi SDK 官方拓展文档，了解扩展机制和最佳实践',
        '2. **方案建议** — 根据用户需求提出实现方案，包括技术选型和设计思路',
        '3. **讨论确认** — 与用户讨论方案，听取反馈，调整设计',
        '4. **定版执行** — 用户确认方案后，开始实现',
        '',
        '## 可用工具',
        '所有内置工具已开放（read / write / edit / bash / glob / grep 等）。',
        '',
        '## 行为准则',
        '- 回复清晰简洁',
        '- 多步骤操作时分步进行',
        '- 不确定时如实告知',
        '- 项目核心源码可读，但修改前先与用户沟通',
        '',
      ].join('\n');
    }

    const appendix = this.buildMemoryAppendix(memoryCtx);
    return {
      normal: normalBase + '\n\n' + appendix,
      sudo: sudoBase + '\n\n' + appendix,
    };
  }

  /** 是否处于 sudo 模式 */
  get isSudoMode(): boolean {
    return this._activeSudoSessionId !== null;
  }

  /** 获取当前 sudo 会话的标签，无标签返回 null */
  getCurrentSudoSessionName(): string | null {
    if (!this._activeSudoSessionId) return null;
    const all = this.loadSudoSessionsIndex();
    const session = all.find(s => s.id === this._activeSudoSessionId);
    return session?.name ?? null;
  }

  /** 列出所有 sudo 会话（按更新时间降序） */
  async listSudoSessions(): Promise<SudoSessionMeta[]> {
    const sessions = this.loadSudoSessionsIndex();
    sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return sessions;
  }

  /**
   * 进入 sudo 模式：保存正常会话，创建独立 sudo session
   * @param label 可选标签，传入后通过 Pi SDK 的 setSessionName 设置
   */
  async enterSudo(label?: string): Promise<string | null> {
    const session = await this.ensureSession();
    if (session.isProcessing) await session.stop();

    // 保存正常会话
    this._savedNormalSession = this._currentSession!;
    this._savedNormalDate = this._currentDate;
    this._currentSession = null;

    // 创建新 sudo 会话
    const id = randomUUID();
    try {
      this._currentSession = await this.config.piFactory.create({
        llm: this.config.llm,
        systemPrompt: this.loadSudoPrompt(),
        workspaceDir: this.config.workspaceDir,
        enableAllTools: true,
        agentDir: join(this.config.workspaceDir ?? process.cwd(), '.pi'),
        sessionPath: this.sudoSessionFilePath(id),
      });
    } catch (err: unknown) {
      // 创建失败，恢复
      this._currentSession = this._savedNormalSession;
      this._savedNormalSession = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('[sudo] 创建 session 失败:' + msg);
      return '进入 sudo 模式失败：' + msg;
    }

    this._activeSudoSessionId = id;

    // 设置标签
    if (label) {
      this._currentSession.setSessionName(label);
    }

    // 记入索引
    const now = formatTs(new Date());
    const sessions = this.loadSudoSessionsIndex();
    sessions.push({ id, name: label ?? null, createdAt: now, updatedAt: now });
    this.saveSudoSessionsIndex(sessions);

    this.log.info(`[sudo] 已进入 sudo 模式 id=${id} label=${label ?? '(无)'}`);
    return null;
  }

  /**
   * 通过序号进入已有 sudo 会话（序号从 1 开始，listSudoSessions 的排序）
   */
  async enterSudoByIndex(index: number): Promise<string | null> {
    const sessions = await this.listSudoSessions();
    if (index < 1 || index > sessions.length) {
      return '无效的序号。使用 `/sudo` 查看可用会话。';
    }

    const target = sessions[index - 1];
    return this.enterSudoById(target.id);
  }

  /**
   * 通过 ID 进入已有 sudo 会话
   */
  async enterSudoById(id: string): Promise<string | null> {
    const session = await this.ensureSession();
    if (session.isProcessing) await session.stop();

    this._savedNormalSession = this._currentSession!;
    this._savedNormalDate = this._currentDate;
    this._currentSession = null;

    try {
      this._currentSession = await this.config.piFactory.create({
        llm: this.config.llm,
        systemPrompt: this.loadSudoPrompt(),
        workspaceDir: this.config.workspaceDir,
        enableAllTools: true,
        agentDir: join(this.config.workspaceDir ?? process.cwd(), '.pi'),
        sessionPath: this.sudoSessionFilePath(id),
      });
    } catch (err: unknown) {
      this._currentSession = this._savedNormalSession;
      this._savedNormalSession = null;
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('[sudo] 恢复 session 失败:' + msg);
      return '恢复 sudo 会话失败：' + msg;
    }

    this._activeSudoSessionId = id;

    // 更新最后使用时间
    const now = formatTs(new Date());
    const all = this.loadSudoSessionsIndex();
    const idx = all.findIndex(s => s.id === id);
    if (idx >= 0) {
      all[idx].updatedAt = now;
      this.saveSudoSessionsIndex(all);
    }

    this.log.info(`[sudo] 已恢复 sudo 会话 id=${id}`);
    return null;
  }

  /** 退出 sudo 模式：关闭 sudo session，从文件重新加载普通 session（加载新扩展） */
  async exitSudo(label?: string): Promise<string | null> {
    if (!this._savedNormalSession || !this._currentSession || !this._activeSudoSessionId) {
      return '当前不在 sudo 模式。';
    }

    const sudoSession = this._currentSession;
    const id = this._activeSudoSessionId;

    await sudoSession.stop();

    // 更新索引：优先使用用户显式提供的标签，再尝试 Pi SDK 自动生成的名字
    const all = this.loadSudoSessionsIndex();
    const idx = all.findIndex(s => s.id === id);
    if (idx >= 0) {
      if (label) {
        all[idx].name = label;
      } else {
        const piName = sudoSession.getSessionName();
        if (piName) {
          all[idx].name = all[idx].name ?? piName;
        }
      }
      all[idx].updatedAt = formatTs(new Date());
      this.saveSudoSessionsIndex(all);
    }

    sudoSession.dispose();

    // 释放旧的普通 session（不再 restore，改为重新加载）
    this._savedNormalSession.dispose();

    // 从 session JSONL 文件重新加载普通 session，此时会加载最新扩展
    const savedDate = this._savedNormalDate;
    try {
      const memoryCtx = await loadMemoryContext({ dataDir: this.config.dataDir });
      const prompts = await this.loadOrGeneratePrompts(memoryCtx);
      this._currentSystemPrompt = prompts.normal;

      const sessionPath = join(this.config.dataDir, 'sessions', `${savedDate}.jsonl`);
      this._currentSession = await this.config.piFactory.create({
        llm: this.config.llm,
        systemPrompt: prompts.normal,
        workspaceDir: this.config.workspaceDir,
        agentDir: join(this.config.workspaceDir ?? process.cwd(), '.pi'),
        sessionPath,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error('[sudo] 重新加载普通 session 失败:' + msg);
      this._currentSession = null; // 置空后 ensureSession 会兜底创建新 session
    }

    this._currentDate = savedDate;
    this._savedNormalSession = null;
    this._savedNormalDate = '';
    this._activeSudoSessionId = null;

    this.log.info('[sudo] 已退出 sudo 模式，已重新加载普通 session');
    return null;
  }

  /** 加载 sudo 提示词 */
  private loadSudoPrompt(): string {
    const promptDir = getPromptsDir();
    const file = join(promptDir, 'sudo.md');
    try {
      return readFileSync(file, 'utf-8');
    } catch {
      return [
        '你是 PiPal，基于 Pi SDK 二次开发的 AI 助理，当前处于**开发者模式**。',
        '',
        '你的专属工作区是项目的 `workspace/` 目录（即当前目录），所有操作限在该目录内。',
        '',
        '## 用户自定义说明',
        '`Instructions.md`（工作区根目录）是用户写给你的操作指南和使用说明，告诉你需要遵守什么规则以及怎么执行任务。',
        '',
        '- 如果用户提出新的要求或注意事项，你负责更新这个文件',
        '- 如果你觉得有什么值得记入的，主动询问用户',
      ].join('\n');
    }
  }

  // ── sudo 会话索引管理 ──

  private sudoSessionFilePath(id: string): string {
    return join(this._sudoSessionsDir, `${id}.jsonl`);
  }

  private get sudoIndexPath(): string {
    return join(this._sudoSessionsDir, 'index.json');
  }

  private loadSudoSessionsIndex(): SudoSessionMeta[] {
    try {
      const raw = readFileSync(this.sudoIndexPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  private saveSudoSessionsIndex(sessions: SudoSessionMeta[]): void {
    mkdirSync(this._sudoSessionsDir, { recursive: true });
    writeFileSync(this.sudoIndexPath, JSON.stringify(sessions, null, 2), 'utf-8');
  }

  private buildMemoryAppendix(memoryCtx: { shortTerm: string[]; mediumTerm: string[]; permanent: string[] }): string {
    const parts: string[] = [];

    if (memoryCtx.permanent.length > 0) {
      parts.push('## 永久记忆（以下信息是用户确认需要记住的）');
      parts.push(...memoryCtx.permanent.map(s => `- ${s}`));
      parts.push('');
    }

    if (memoryCtx.shortTerm.length > 0) {
      parts.push('## 最近每日摘要');
      parts.push(...memoryCtx.shortTerm);
      parts.push('');
    }

    if (memoryCtx.mediumTerm.length > 0) {
      parts.push('## 最近每周总结');
      parts.push(...memoryCtx.mediumTerm);
      parts.push('');
    }

    return parts.join('\n');
  }

  private formatDate(d: Date): string {
    return formatDate(d);
  }
}
