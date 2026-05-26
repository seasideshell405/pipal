import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import * as readline from 'node:readline';

function ask(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * 读取 .env 文件为键值对对象（不加载到 process.env）
 */
export function readEnvFile(): Record<string, string> {
  const envPath = '.env';
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      result[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
    }
  }
  return result;
}

/**
 * 写入/更新 .env 文件中的某个变量（保留注释和现有顺序）
 */
export function writeEnvVar(key: string, value: string): void {
  const envPath = '.env';
  let content = '';
  if (existsSync(envPath)) {
    content = readFileSync(envPath, 'utf-8');
  }

  const lines = content.split('\n');
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${key}=`)) {
      lines[i] = `${key}=${value}`;
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] !== '') {
      lines.push('');
    }
    lines.push(`${key}=${value}`);
  }

  writeFileSync(envPath, lines.join('\n') + '\n', 'utf-8');
}

/**
 * 检测配置是否完整，缺失则进入交互式设置
 * 设置完成后，值也会写入 process.env 供后续 loadConfig 使用
 */
export async function ensureSetup(): Promise<void> {
  // 先试 process.env（可能是真实环境变量或 dotenv 已加载）
  if (process.env.LLM_API_KEY) return;

  // 再试 .env 文件
  const env = readEnvFile();
  if (env.LLM_API_KEY) {
    process.env.LLM_API_KEY = env.LLM_API_KEY;
    return;
  }

  console.log('\n========================================');
  console.log('  PiPal 首次启动设置');
  console.log('========================================\n');

  const apiKey = await ask('请输入 LLM API Key: ');
  if (!apiKey) throw new Error('LLM API Key 不能为空');

  writeEnvVar('LLM_API_KEY', apiKey);
  process.env.LLM_API_KEY = apiKey;

  console.log('\n配置已保存到 .env，继续启动...\n');
}
