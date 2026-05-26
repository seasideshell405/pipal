import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** dist/prompts/（构建时从 src/prompts/ 复制） */
export function getPromptsDir(): string {
  return join(__dirname, 'prompts');
}
