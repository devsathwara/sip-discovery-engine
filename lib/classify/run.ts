import { classificationSchema, type ClassificationResult } from '@/lib/classify/schema';
import { CLASSIFIER_SYSTEM, classifierUserMessage } from '@/lib/classify/taxonomy';

export type TokenUsage = {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
};

export type ClassifyCall = {
  result: ClassificationResult | null;
  usage: TokenUsage;
  model: string;
  error: string | null;
};

type ChatBody = {
  model?: string;
  choices?: { message?: { content?: string } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

function emptyUsage(): TokenUsage {
  return { promptTokens: 0, cachedTokens: 0, completionTokens: 0 };
}

function addUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    promptTokens: left.promptTokens + right.promptTokens,
    cachedTokens: left.cachedTokens + right.cachedTokens,
    completionTokens: left.completionTokens + right.completionTokens
  };
}

function usageOf(body: ChatBody): TokenUsage {
  return {
    promptTokens: body.usage?.prompt_tokens ?? 0,
    cachedTokens: body.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    completionTokens: body.usage?.completion_tokens ?? 0
  };
}

async function oneCall(item: { source: string; date: string; text: string }, attempt: number, hint?: string): Promise<ClassifyCall> {
  const key = process.env.XAI_API_KEY || process.env.LLM_API_KEY || '';
  const model = process.env.LLM_MODEL || 'grok-4.20-0309-non-reasoning';
  if (!key) return { result: null, usage: emptyUsage(), model, error: 'XAI_API_KEY is not set. No classification calls were made.' };
  let response: Response;
  try {
    response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: CLASSIFIER_SYSTEM },
          { role: 'user', content: hint ? `${classifierUserMessage(item)}\n${hint}` : classifierUserMessage(item) }
        ]
      }),
      signal: AbortSignal.timeout(60_000)
    });
  } catch (error) {
    return { result: null, usage: emptyUsage(), model, error: error instanceof Error ? error.message : 'request failed' };
  }
  if (response.status === 429 && attempt < 4) {
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
    return oneCall(item, attempt + 1, hint);
  }
  const bodyText = await response.text();
  if (!response.ok) {
    return { result: null, usage: emptyUsage(), model, error: `Model HTTP ${response.status}: ${bodyText.slice(0, 180)}` };
  }
  let body: ChatBody;
  try {
    body = JSON.parse(bodyText) as ChatBody;
  } catch {
    return { result: null, usage: emptyUsage(), model, error: 'Model response was not JSON' };
  }
  const content = body.choices?.[0]?.message?.content ?? '';
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return { result: null, usage: usageOf(body), model: body.model || model, error: 'Model did not return JSON' };
  }
  const parsed = classificationSchema.safeParse(raw);
  const issue = parsed.success
    ? ''
    : parsed.error.issues
        .slice(0, 3)
        .map((item) => `${item.path.join('.') || 'root'}: ${item.message}`)
        .join('; ');
  return {
    result: parsed.success ? parsed.data : null,
    usage: usageOf(body),
    model: body.model || model,
    error: parsed.success ? null : `Model JSON did not match the taxonomy schema (${issue})`
  };
}

export async function classifyItem(item: { source: string; date: string; text: string }): Promise<ClassifyCall> {
  const first = await oneCall(item, 0);
  if (first.result || first.error === 'XAI_API_KEY is not set. No classification calls were made.') return first;
  if (first.error?.startsWith('Model HTTP 429') || first.error?.startsWith('XAI')) return first;
  const hint = first.error?.includes('quote is over 25 words')
    ? 'Your quote exceeded 25 words. Return the JSON again with a verbatim quote of 25 words or fewer.'
    : undefined;
  const second = await oneCall(item, 0, hint);
  return {
    result: second.result,
    usage: addUsage(first.usage, second.usage),
    model: second.model,
    error: second.result ? null : second.error || first.error
  };
}

export const INPUT_USD_PER_MILLION = 1.25;
export const CACHED_USD_PER_MILLION = 0.2;
export const OUTPUT_USD_PER_MILLION = 2.5;

export function costUsd(usage: TokenUsage, model: string): number | null {
  if (model !== 'grok-4.20-0309-non-reasoning') return null;
  const cached = Math.min(usage.cachedTokens, usage.promptTokens);
  const fresh = Math.max(0, usage.promptTokens - cached);
  return (fresh * INPUT_USD_PER_MILLION + cached * CACHED_USD_PER_MILLION + usage.completionTokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}
