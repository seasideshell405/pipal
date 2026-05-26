import { readFileSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LlmClient } from '../llm-client.js';
import { formatDate } from '../date-utils.js';
import { getPromptsDir } from '../prompt-dir.js';

export interface WeeklySummaryResult {
  summary: string;
}

/**
 * 日期范围，如 startDisplay="2026.05.24"、endDisplay="05.30"、fileSafe="2026.05.24-05.30"
 */
function formatRange(sunday: Date, saturday: Date): { startDisplay: string; endDisplay: string; fileSafe: string } {
  const sy = sunday.getFullYear();
  const sm = String(sunday.getMonth() + 1).padStart(2, '0');
  const sd = String(sunday.getDate()).padStart(2, '0');
  const em = String(saturday.getMonth() + 1).padStart(2, '0');
  const ed = String(saturday.getDate()).padStart(2, '0');
  return {
    startDisplay: `${sy}.${sm}.${sd}`,
    endDisplay: `${em}.${ed}`,
    fileSafe: `${sy}.${sm}.${sd}-${em}.${ed}`,
  };
}

function getSunday(d: Date): Date {
  const result = new Date(d);
  result.setDate(result.getDate() - result.getDay());
  return result;
}

function getSaturday(d: Date): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + (6 - result.getDay()));
  return result;
}

function loadPrompt(): string {
  const filePath = join(getPromptsDir(), 'weekly-summary.md');
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    // 文件不存在时的兜底提示词
    return [
      '请根据过去 7 天的每日摘要生成周总结，必须严格按照以下格式输出：',
      '',
      '===== 格式示例 =====',
      '# 2026.05.18-05.24',
      '',
      '## 本周概览',
      '用户本周主要关注 Python 学习和项目搭建，讨论了多个技术方案并做出一些偏好确认。周末安排了户外活动。',
      '',
      '## 关键信息',
      '- 用户在做 Python 爬虫项目，使用 requests + BeautifulSoup（5月20日）',
      '- 不喜欢吃辣，偏好清淡饮食（5月21日）',
      '- 周末计划去爬山（5月22日）',
      '- 确认用第一人称记日记（5月24日）',
      '',
      '## 每日摘要',
      '',
      '### 5月20日 周一',
      '讨论 Python 学习路线，开始写爬虫项目。安装配置遇到几个问题已解决。',
      '',
      '### 5月21日 周二',
      '继续爬虫开发，完成数据解析功能。午饭讨论确认不吃辣。',
      '',
      '### 5月22日 周三',
      '用户说周末想去爬山，AI 提醒注意事项。爬虫项目基本完成。',
      '',
      '### 5月23日 周四',
      '日常闲聊，没有重要事件。',
      '',
      '### 5月24日 周五',
      '晚上讨论日记格式，确认用第一人称记录。设置早安提醒模板。',
      '===== 格式结束 =====',
      '',
      '要求：',
      '- 标题行格式：`# YYYY.MM.DD-MM.DD`',
      '- `## 本周概览`：一段话概括本周主要话题和用户状态变化（不超过 80 字）',
      '- `## 关键信息`：逐条列出值得长期记住的个人事实、偏好、决定、状态变化，每条末尾标注日期。如果某条信息与上周重复则跳过',
      '- `## 每日摘要`：按天列出，`### M月D日 周X`，简述当天话题和关键事件。不要具体的待办事项',
      '',
      '【每日摘要】',
      '${dailyContent}',
    ].join('\n');
  }
}

/**
 * 读取本周已存在的周总结文件
 */
function loadExistingWeeklySummary(
  dataDir: string,
  range: string,
): string | null {
  const filePath = join(dataDir, 'memories', 'weekly', `${range}.md`);
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 生成每周总结。
 * 读取本周所有每日摘要 → LLM 生成周总结 → 保存到 memory/weekly/YYYY.MM.DD-MM.DD.md
 */
export async function generateWeeklySummary(
  llm: LlmClient,
  dataDir: string,
): Promise<WeeklySummaryResult> {
  const today = new Date();

  // 周日生成上周总结（上周日~周六），其他日期生成当前周
  const ref = today.getDay() === 0
    ? new Date(today.getTime() - 86400000)
    : today;

  const sunday = getSunday(ref);
  const saturday = getSaturday(ref);

  const range = formatRange(sunday, saturday);

  // 如果本周总结已存在，直接读取
  const existing = loadExistingWeeklySummary(dataDir, range.fileSafe);
  if (existing) {
    return { summary: existing };
  }

  // 读取本周每日摘要
  const dailyDir = join(dataDir, 'memories', 'daily');
  const summaries: string[] = [];

  for (let d = new Date(sunday); d <= saturday; d.setDate(d.getDate() + 1)) {
    const filePath = join(dailyDir, `${formatDate(d)}.md`);
    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8').trim();
        if (content) summaries.push(content);
      }
    } catch {
      // skip unreadable files
    }
  }

  if (summaries.length === 0) {
    throw new Error('本周无每日摘要，无法生成周总结');
  }

  const template = loadPrompt();
  const dailyContent = summaries.join('\n\n---\n\n');
  const prompt = template
    .replace('${startDate}', range.startDisplay)
    .replace('${endDate}', range.endDisplay)
    .replace('${dailyContent}', dailyContent);

  const summary = await llm.chat([{ role: 'user', content: prompt }]);

  // 保存周总结
  const weeklyDir = join(dataDir, 'memories', 'weekly');
  await mkdir(weeklyDir, { recursive: true });
  await writeFile(join(weeklyDir, `${range.fileSafe}.md`), summary, 'utf-8');

  return { summary };
}
