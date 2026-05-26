import type { LLMConfig } from './types.js';

export interface LlmClient {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>;
}

export function createLlmClient(config: LLMConfig): LlmClient {
  const baseUrl = config.apiBase.replace(/\/+$/, '');

  return {
    async chat(messages) {
      const res = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`LLM API 错误 (${res.status}): ${text.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      return data.choices?.[0]?.message?.content ?? '';
    },
  };
}
