# PiPal — 私人 AI 助理

一个通过微信与你对话的私人 AI 助理。基于 [Pi SDK](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 驱动 AI 人格，具备记忆能力和可扩展的工具系统。

---

## 它能做什么

- **像朋友一样聊天** — 在微信上随时找它说话，不仅仅是问答，而是有持续记忆的对话
- **记住重要的事** — 你的偏好、约定、关键信息，它会记住并在后续对话中用上
- **自动做笔记** — 每天自动生成对话摘要，每周汇总，不会忘记之前聊过什么
- **通过命令控制** — 在微信里发 `/status` 看状态、`/memories` 查看它记住了什么、`/stop` 打断回复
- **不断增长能力** — 你可以为它编写新技能和工具，让它学会做更多事

## 快速开始

### 前置要求

- Node.js 20+
- 一个微信账号
- 一个兼容 OpenAI 格式的 LLM API Key（如 DeepSeek、OpenAI 等）

### 安装

```bash
git clone https://github.com/seasideshell405/pipal.git
cd pipal
npm install
npm run build
```

### 配置与启动

首次运行会自动进入配置向导，引导你填写 API Key 等信息：

```bash
npm start
```

你也可以手动创建 `.env` 文件。

建议使用 pm2 管理进程（退出终端后仍在后台运行）：

```bash
pm2 start npm --name pipal -- start
```

### 登录微信

启动后控制台会显示一个二维码，用微信扫码即可登录。之后 PiPal 就能在微信上接收和回复你的消息了。

### 基础配置参考

```env
LLM_API_KEY=your_api_key_here
LLM_PROVIDER=deepseek
LLM_MODEL=deepseek-v4-flash
LLM_API_BASE=https://api.deepseek.com
```

所有配置项和说明见 [环境变量](#环境变量) 章节。

---

## 日常使用

### 基础对话

直接把 PiPal 当成微信里的联系人，发消息给它就行。它会有自己的个性（由 Pi SDK 驱动），不是冷冰冰的 API 回复。

### 命令一览

在对话框中发送以下命令：

| 命令 | 作用 |
|------|------|
| `/help` | 查看所有可用命令 |
| `/status` | 显示运行状态、消息统计 |
| `/memories` | 查看它记住了你的哪些信息 |
| `/prompt` | 查看当前 AI 系统提示词和可用工具 |
| `/stop` | 打断正在生成的回复 |
| `/restart` | 重启 PiPal 服务 |
| `/sudo` | 进入开发者模式 |
| `/exit` | 退出开发者模式 |
| `/rollback` | 回滚对话到上一步 |
| `/recall` | 撤回最近一轮对话 |

### 记忆系统

PiPal 有三层记忆：

1. **短期记忆** — 每天自动生成当日对话摘要
2. **中期记忆** — 每周将七天日摘要汇总为周报
3. **永久记忆** — 你确认过的重要信息，持续保留

有了这些，即使隔几天再聊，它也能接上之前的话题。

### 定时任务

PiPal 在后台自动执行以下任务（可在 `.env` 中自定义时间）：

| 时间 | 任务 |
|------|------|
| 凌晨 03:50 | 生成昨日对话摘要 |
| 凌晨 04:10 | 轮换 AI 会话 |
| 周日 03:55 | 汇总本周摘要 |
| 早上 06:00 | 自动备份数据目录 |

---

## 扩展开发

PiPal 的能力可以通过以下两种方式扩展：

- **技能（Skills）** — 用 Markdown 编写的功能模板，告诉 AI 如何完成特定任务（如饮食规划、待办管理）
- **扩展工具（Extensions）** — 用 TypeScript 编写的可执行函数，AI 可以在对话中主动调用

### 预设扩展（可直接使用）

`workspace/` 目录包含预先编写好的扩展和技能，开箱即用 —— PiPal 启动后会自动加载它们。

### 自行开发

你也可以在 `/sudo` 模式下创建和调试自己的扩展与技能：

```
正常模式 → 发 /sudo 进入开发者模式 → 编写新技能/工具 → 发 /exit 退出 → 正常模式已增强
```

`/sudo` 进入一个沙盒工作区，你可以在里面安全地开发新功能。退出后，正常对话中也能使用这些能力。

所有扩展和技能存放在：
- `workspace/.pi/skills/` — 技能定义
- `workspace/.pi/extensions/` — 扩展工具

---

## 架构概览

```
你 ←→ 微信 ←→ PiPal（服务端）
                  │
            ┌─────┴─────┐
            │            │
        命令路由      Pi SDK（AI 人格）
            │            │
            │       ┌────┴────┐
            │       │ 记忆系统 │
            │       │ 扩展工具 │
            │       └─────────┘
            │
        ┌───┴───┐
        │ 定时任务 │
        │ 备份服务 │
        └───────┘
```

## 项目结构

```
pipal/
├── src/                    # 源码
│   ├── index.ts            # 主入口
│   ├── config.ts           # 配置加载
│   ├── types.ts            # 核心类型定义
│   ├── logger.ts           # 日志系统
│   ├── setup.ts            # 首次启动配置向导
│   ├── pi-session.ts       # Pi SDK 会话封装
│   ├── pi-manager.ts       # Session 生命周期管理
│   ├── llm-client.ts       # LLM 客户端（摘要生成）
│   ├── backup.ts           # 每日数据备份
│   ├── date-utils.ts       # 日期工具（4 点日界）
│   ├── reminder-checker.ts # 定时提醒引擎
│   ├── scheduler.ts        # 定时任务调度
│   ├── prompt-dir.ts       # prompt 目录定位
│   ├── commands/           # 命令系统
│   ├── memory/             # 记忆系统源码
│   ├── platform/           # 平台接入层（WeChat iLink）
│   └── prompts/            # 系统提示词模板
├── data/                   # 运行时数据（不纳入 git）
│   ├── archives/           # 对话归档（JSONL）
│   ├── logs/               # 应用日志
│   ├── memories/           # 记忆数据文件
│   └── backups/            # 每日备份
└── workspace/              # 开发者模式沙盒
    └── .pi/
        ├── extensions/     # 扩展工具
        └── skills/         # 技能定义
```

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LLM_API_KEY` | — | LLM API 密钥（必填） |
| `LLM_PROVIDER` | `deepseek` | 可选：`openai` / `deepseek` / `custom` |
| `LLM_MODEL` | `deepseek-v4-flash` | 模型名称 |
| `LLM_API_BASE` | `https://api.deepseek.com` | API 地址 |
| `WECHAT_ILINK_BOT_TYPE` | `3` | 机器人类型 |
| `WECHAT_ILINK_API_BASE` | `https://ilinkai.weixin.qq.com` | iLink API 地址 |
| `WECHAT_ILINK_BOT_TOKEN` | — | 登录后自动写入 |
| `WECHAT_ILINK_USER_ID` | — | 登录后自动写入 |
| `DATA_DIR` | `./data` | 数据目录 |
| `CRON_DAILY_SUMMARY` | `50 3 * * *` | 每日摘要 cron |
| `CRON_SESSION_ROTATION` | `10 4 * * *` | 会话轮换 cron |
| `CRON_WEEKLY_SUMMARY` | `55 3 * * 0` | 每周总结 cron |
| `CRON_BACKUP` | `0 6 * * *` | 项目备份 cron |

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.4+, ES2022 |
| 模块 | NodeNext (ESM) |
| 运行时 | Node.js 20+ |
| AI 引擎 | Pi SDK (`@earendil-works/pi-coding-agent`) |
| 接入平台 | WeChat iLink HTTP API |
| 定时任务 | node-cron |
| 配置 | dotenv + .env |
| 构建 | tsc |

## 许可

MIT
