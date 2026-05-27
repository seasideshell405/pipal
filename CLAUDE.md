# PiPal -- 私人 AI 助理

## 项目概述

PiPal 是一个基于 WeChat iLink 协议的私人 AI 助理。用户通过微信与 PiPal 对话，PiPal 使用 Pi SDK（`@earendil-works/pi-coding-agent`）驱动 AI 人格，并提供内置命令系统和记忆管理功能。

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.4+, ES2022 |
| 模块 | NodeNext (ESM), 引用使用 `.js` 扩展名 |
| 运行时 | Node.js 20+ |
| AI 引擎 | `@earendil-works/pi-coding-agent` v0.75.5 (动态 ESM import) |
| 接入平台 | WeChat iLink API (HTTP 长轮询) |
| 定时任务 | `node-cron` v3 |
| 配置 | `dotenv` + `.env` 文件 |
| 运行方式 | `tsx` 直接执行 TypeScript 源码（无需编译） |

## NPM 脚本

```bash
npm run build        # tsc --noEmit 类型检查
npm start            # tsx src/index.ts
npm run dev          # tsc --watch 监听模式
npm test             # jest --passWithNoTests
npm run test:watch   # jest --watch
```

## 进程管理

应用由 **pm2** 管理，使用 `tsx watch` 直接运行源码，修改 `src/` 后自动重启。

```bash
pm2 logs              # 查看实时日志
pm2 restart pipal     # 重启应用
pm2 stop pipal        # 停止
pm2 status            # 查看状态
pnpm start            # 启动（首次）：pm2 start npx --name pipal -- tsx watch src/index.ts
```

## 源码架构

所有源码位于 `src/`，直接由 `tsx watch` 运行（无需编译），运行时数据到 `data/`。

### 入口与配置

| 文件 | 职责 |
|------|------|
| `src/index.ts` | 主入口：配置加载、组装所有子系统、启动 adapter 和 scheduler |
| `src/config.ts` | 从环境变量加载 `AppConfig`，含默认值 |
| `src/types.ts` | 核心类型：`Message`、`LLMConfig`、`AppConfig` |
| `src/setup.ts` | 首次启动交互式配置（提示输入 API Key，写入 .env） |
| `src/logger.ts` | 每日轮转文件日志 + 控制台输出 |

### Pi SDK 集成

| 文件 | 职责 |
|------|------|
| `src/pi-session.ts` | `IPiSession` 接口 + `PiSessionFactory`（动态 import Pi SDK）+ `PiSession` 封装 |
| `src/pi-manager.ts` | `SessionManager`：Session 生命周期（每日轮换）、sudo 模式、记忆上下文注入、定时任务消息处理 |
| `src/llm-client.ts` | OpenAI 兼容的 LLM 客户端（用于摘要生成，基于 fetch） |
| `src/prompts/` | 系统提示词模板（normal.md、sudo.md 等），构建时复制到 dist |
| `src/prompt-dir.ts` | 运行时自动定位 prompts 目录的辅助函数 |

### 命令系统

| 文件 | 职责 |
|------|------|
| `src/commands/index.ts` | `CommandContext` / `CommandHandler` 接口 + `CommandRouter` 路由注册 |

每个命令是一个 `CommandHandler` 对象（`{ name, description, usage?, handle(ctx) }`），通过 `CommandRouter` 注册。

| 命令 | 文件 | 功能 |
|------|------|------|
| `/help` | `src/commands/help.ts` | 列出所有可用命令 |
| `/status` | `src/commands/status.ts` | 显示运行状态和统计数据 |
| `/memories` | `src/commands/memory.ts` | 列出所有永久记忆 |
| `/prompt` | `src/commands/prompt.ts` | 查看当前 Pi 系统提示词和活跃工具 |
| `/stop` | `src/commands/stop.ts` | 打断当前 Pi 执行 |
| `/restart` | `src/commands/restart.ts` | 重启 PiPal 应用 |
| `/sudo` | `src/commands/sudo.ts` | 进入开发者模式（开放全部工具） |
| `/exit` | `src/commands/sudo.ts` | 退出开发者模式，总结并折叠期间内容 |
| `/rollback` | `src/commands/rollback.ts` | 回退对话，带总结折叠 |
| `/recall` | `src/commands/recall.ts` | 撤回最近一轮对话，不留痕迹 |

### 记忆系统

| 文件 | 职责 |
|------|------|
| `src/memory/index.ts` | `loadMemoryContext()`：聚合短期/中期/永久记忆到上下文附录 |
| `src/memory/permanent.ts` | `PermanentMemory`：JSON 文件持久化记忆条目（增删查） |
| `src/memory/archival.ts` | `Archive`：逐日 JSONL 对话归档（追加、按日期查询） |
| `src/memory/daily-summary.ts` | `generateDailySummary()` / `generateYesterdaySummary()`：LLM 将对话摘要为 MD 文件；提示词从 `src/prompts/daily-summary.md` 加载（有兜底） |
| `src/memory/weekly-summary.ts` | `generateWeeklySummary()`：LLM 将 7 天日摘总结为周报；提示词从 `src/prompts/weekly-summary.md` 加载；已存在时跳过 |

### 平台层

| 文件 | 职责 |
|------|------|
| `src/platform/interface.ts` | `BotPlatform` 接口 + `Message` 类型 |
| `src/platform/ilink-api.ts` | WeChat iLink HTTP API 客户端（QR 登录、轮询、收发消息） |
| `src/platform/wechat-ilink.ts` | `WeChatIlinkAdapter`：实现 `BotPlatform`，扫码登录 + 长轮询 |

### 调度与工具

| 文件 | 职责 |
|------|------|
| `src/scheduler.ts` | `startScheduler()`：注册 5 个 cron 任务（每日摘要、每周总结、Session 轮换、项目备份、提醒检查） |
| `src/reminder-checker.ts` | `checkDueSchedules()`：JSON 文件匹配引擎，检查到期提醒 |
| `src/backup.ts` | `backupProject()`：每日备份 data/ 和 workspace/data/ 到 backups 目录 |
| `src/date-utils.ts` | `formatDate()`、`formatTs()`、`getEffectiveToday()`：4 点日界（凌晨 4 点前归入前一天），对齐 Session 轮换时间 |

## 运行时数据目录

```
data/
  archives/           YYYY-MM-DD.jsonl    对话归档
  backups/            每日备份目录（data/ + workspace/data/）
  logs/               YYYY-MM-DD.log      应用日志
  memories/
    daily/            YYYY-MM-DD.md       每日摘要
    weekly/           YYYY.MM.DD-MM.DD.md 每周总结（含周次）
    permanent.json                         永久记忆条目
  sessions/           YYYY-MM-DD.jsonl    Pi SDK 会话文件
```

## 环境变量 (.env)

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | LLM API 密钥（必填） |
| `LLM_PROVIDER` | `deepseek` | 可选: `openai`, `deepseek`, `custom` |
| `LLM_MODEL` | `deepseek-v4-flash` | 模型名 |
| `LLM_API_BASE` | `https://api.deepseek.com` | API 地址 |
| `WECHAT_ILINK_BOT_TYPE` | `3` | 机器人类型 |
| `WECHAT_ILINK_API_BASE` | `https://ilinkai.weixin.qq.com` | iLink API 地址 |
| `WECHAT_ILINK_BOT_TOKEN` | — | 首次扫码后自动写入 |
| `WECHAT_ILINK_USER_ID` | — | 首次扫码后自动写入 |
| `DATA_DIR` | `./data` | 数据目录 |

Cron 环境变量（cron 表达式，5 字段标准格式）:

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CRON_DAILY_SUMMARY` | `50 3 * * *` | 每日摘要（凌晨 3:50） |
| `CRON_SESSION_ROTATION` | `10 4 * * *` | Session 轮换（凌晨 4:10） |
| `CRON_WEEKLY_SUMMARY` | `55 3 * * 0` | 每周总结（周日 3:55，在日摘要之后轮换之前） |
| `CRON_BACKUP` | `0 6 * * *` | 项目备份（早上 6:00） |

## 构建配置

- `tsconfig.json`：严格模式、source maps、declarations、`isolatedModules: true`
- 排除 `node_modules`、`dist`、`tests`
- import 使用 `.js` 扩展名（NodeNext 模块解析）

## 开发约定

### 代码风格
- 所有用户交互使用**简体中文**
- 使用 `node:` 前缀导入 Node 内置模块（如 `node:path`、`node:fs`）
- Pi SDK 使用动态 `import()`（ESM-only 包）
- 工厂函数模式创建子系统（`createXxx()`）
- `CommandHandler` 接口：`{ name, description, usage?, handle(ctx) }`
- 日期格式统一 `YYYY-MM-DD`

### 架构模式
- **两层架构**：PiPal 调度层（命令路由、定时任务、记忆管理）+ Pi SDK 人格层（AI 对话）
- **命令路由**：`/` 前缀的消息进入 `CommandRouter`，未匹配则走 Pi 对话
- **Session 管理**：每日轮换（`YYYY-MM-DD.jsonl`），支持 sudo 模式（checkpoint + navigateTree 回滚）
- **记忆金字塔**：短期（每日摘要）→ 中期（每周总结）→ 永久（用户确认的关键信息）

### 提交规范
遵循 Conventional Commits：`feat:`、`fix:`、`refactor:`、`docs:`、`test:`

### 开发阶段
| 阶段 | 状态 | 内容 |
|------|------|------|
| Phase 0 | 完成 | 项目搭建、配置加载 |
| Phase 1 | 完成 | WeChat iLink 平台接入 |
| Phase 2 | 完成 | 命令系统（路由 + 内置命令） |
| Phase 3 | 完成 | LLM 对话集成（Pi SDK） |
| Phase 4 | 完成 | 记忆系统（永久记忆、每日摘要、每周总结） |
| Phase 5 | 完成 | 工作区沙盒 — sudo 模式 + workspaceDir 隔离，Pi 的操作限定在 `workspace/` 内，项目源码透明不可见 |
| Phase 6 | 待开发 | 更多功能 |

## 测试

- 测试框架：Jest（`jest --passWithNoTests`）
- 测试目录：`tests/`（当前已删除所有测试文件）
- 无 `jest.config.ts` 配置文件，使用 Jest 默认配置
