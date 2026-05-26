# Instructions


- `.pi/extensions/` — AI 的扩展工具，每个文件注册一个 tool
- `.pi/skills/` — AI 的操作指南，描述怎么执行特定任务
- `data/` — AI 产生的数据


## 关于 Skill 和 Extension Tool

- Extension tool（`workspace/.pi/extensions/`）自带名称和描述，如果描述已经把用法说清楚了，就不需要为它写 skill。
- Skill（`workspace/.pi/skills/`）只描述操作流程和用法。

### Skill 基本写法

一个 skill 文件通常包含这些部分，按需选用：

```markdown
---
name: 技能名
description: 一句话说明
---

## 触发条件
什么场景下激活这个 skill。

## 执行逻辑
操作流程，分步描述。可以引用 extension tool。

## 边界说明
什么情况下不适用，或者需要注意什么。
```

没有强制结构，按实际情况增减即可。

### Extension 基本写法

一个 extension 文件（TS）固定结构，按需选用能力：

```typescript
// 头部：导入官方类型与依赖
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// 主体：默认导出入口函数（同步/async 均可）
export default function (pi: ExtensionAPI) {
  // 1. 事件监听：会话、工具调用等生命周期钩子
  pi.on("事件名", (event, ctx) => { /* 逻辑 */ });

  // 2. 注册工具：供 LLM 调用，配置参数 + 执行逻辑
  pi.registerTool({
    name: "",
    label: "",
    description: "",
    parameters: Type.Object({}),
    async execute() { /* 执行代码 */ },
  });

  // 3. 注册命令：以 / 开头的手动指令
  pi.registerCommand("命令名", {
    description: "",
    handler() { /* 执行代码 */ },
  });
}
```

## 日期处理规则

- **不要用 `d.toISOString().slice(0, 10)` 取日期字符串**，因为此写法返回 UTC 日期，比北京时间晚 8 小时。
- 用 `d.getFullYear()` + `d.getMonth() + 1` + `d.getDate()` 本地方法手动拼接字符串。
