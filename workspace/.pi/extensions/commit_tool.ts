/**
 * commit_tool — Pi 扩展
 *
 * 注册 commit 工具，让 Pi 在 sudo 模式下安全地提交项目代码。
 * 自动从项目根目录（工作区上级目录）执行 git 操作。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";

// 工作区在 project/workspace，项目根目录是 workspace/..
const PROJECT_ROOT = process.cwd().replace(/\/workspace\/?$/, "") || process.cwd();

const commitTool = defineTool({
  name: "commit",
  label: "提交项目代码",
  description:
    "提交项目代码到 git。会先 stage 所有变更（git add -A），然后提交。请在提交前确保变更已经过用户确认。",
  parameters: Type.Object({
    message: Type.String({
      description: "提交信息，简洁描述本次变更内容",
    }),
  }),

  async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    try {
      // git add -A
      execSync("git add -A", { cwd: PROJECT_ROOT, encoding: "utf-8" });

      // 检查是否有变更要提交
      const status = execSync("git status --porcelain", {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      }).trim();

      if (!status) {
        return {
          content: [{ type: "text", text: "没有未提交的变更。" }],
          details: undefined,
        };
      }

      // git commit
      const result = execSync(`git commit -m "${params.message.replace(/"/g, '\\"')}"`, {
        cwd: PROJECT_ROOT,
        encoding: "utf-8",
      }).trim();

      return {
        content: [
          {
            type: "text",
            text: `提交成功：\n\`\`\`\n${result}\n\`\`\`\n\n变更文件：\n\`\`\`\n${status}\n\`\`\``,
          },
        ],
        details: undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `提交失败：${msg}` }],
        details: undefined,
      };
    }
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(commitTool);
}
