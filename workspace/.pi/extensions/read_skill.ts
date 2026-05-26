/**
 * read_skill — Pi 扩展：读取技能文件的完整内容
 *
 * 注册 read_skill 工具，让 AI 可以按名称加载 skill 的详细指令。
 * 普通模式下 read 不可用，此工具仅限读取 .pi/skills/ 目录下的 .md 文件。
 */
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join, normalize, relative } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const SKILLS_DIR = join(process.cwd(), ".pi", "skills");

const readSkill = defineTool({
  name: "read_skill",
  label: "读取技能文件",
  description:
    "读取指定 skill 的完整内容（触发条件、操作步骤、回复模板）。" +
    "参数 name 是技能的短名称，如 todo_manager、diet_planner。",
  parameters: Type.Object({
    name: Type.String({ description: "skill 名称" }),
  }),

  execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
    const skillName = params?.name;
    if (!skillName || typeof skillName !== "string") {
      return { content: [{ type: "text", text: "错误：请提供 skill 名称" }] };
    }

    // 安全校验：防止目录穿越
    const safeName = skillName.replace(/\.\./g, "").replace(/[/\\]/g, "");
    if (!safeName) {
      return { content: [{ type: "text", text: `错误：无效的 skill 名称 "${skillName}"` }] };
    }

    const filePath = join(SKILLS_DIR, `${safeName}.md`);
    const resolved = normalize(filePath);
    const rel = relative(SKILLS_DIR, resolved);

    // 确保解析后的路径仍在 skills 目录内
    if (rel.startsWith("..") || !rel.endsWith(".md")) {
      return { content: [{ type: "text", text: `错误：无效的 skill 名称 "${skillName}"` }] };
    }

    if (!existsSync(resolved)) {
      return { content: [{ type: "text", text: `错误：找不到 skill "${skillName}"` }] };
    }

    const content = readFileSync(resolved, "utf-8");
    return { content: [{ type: "text", text: content }] };
  },
});

export default function (pi: ExtensionAPI) {
  pi.registerTool(readSkill);
}
