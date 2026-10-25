/**
 * Shared LLM client for Lina Learning — Polyvor (phala GLM-5.3-Flash) PRIMARY,
 * DeepSeek V4 Flash (Phala) SECONDARY, pi-bansos LAST-RESORT.
 *
 * Tested 2026-10-24:
 *   1. phala/z-ai/glm-5.3-flash — WORKS (1M ctx, 131K output, free, no 429)
 *   2. phala/deepseek/deepseek-v4-flash-0731 — WORKS as fallback
 *   3. pi-bansos chain (Cohere→Nemotron→Poolside) — last resort
 *   4. CF Worker relays — bypass 200 req/hr per-IP limit
 *
 * jsonMode (default true): forces response_format: { type: 'json_object' }
 * untuk eliminate reasoning-text prefix issue.
 */

import {
  logFallbackEvent,
  incrementUsage,
  type FallbackEvent,
} from '@/lib/llm-health-log';

const POLYVOR_URL = process.env.POLYVOR_URL || 'https://gateway.polyvorlabs.com/v1';
const POLYVOR_API_KEY = process.env.POLYVOR_API_KEY || '';
// v-fast (2026-10-25): default ganti phala/z-ai/glm-5.3-flash → ag/claude-opus-4-6-thinking(xhigh).
// Benchmark di VPS: glm-5.3-flash throughput 28 tok/s + sering error 54s internal gateway.
// claude-opus throughput 140 tok/s (5x lebih cepat), reliable.
// Untuk L3 mega-generate target ~35K output: glm-5.3-flash 21 menit, claude-opus 4 menit.
// Polyvor gateway status: hanya 4 model yang alive (claude-opus, glm-5.3, glm-5.3-flash,
// deepseek-v4-flash). Semua model jr/* lagi outage. claude-opus adalah pilihan tercepat.
const POLYVOR_MODEL = process.env.POLYVOR_MODEL || 'ag/claude-opus-4-6-thinking(xhigh)';
const POLYVOR_FALLBACK_MODEL = process.env.POLYVOR_FALLBACK_MODEL || 'phala/deepseek/deepseek-v4-flash-0731';

const PI_BANSOS_URL = process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1';
const PI_BANSOS_KEY = 'placeholder';

const CF_RELAY_URLS = (process.env.CF_RELAY_URLS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

export const PI_BANSOS_MODELS = {
  cohere: 'cohere/north-mini-code:free',
  nemotron: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  poolside: 'poolside/laguna-s-2.1:free',
} as const;

export type LLMTask = 'fast' | 'long' | 'code' | 'conversation' | 'structured-json';

const TASK_MODEL_CHAIN: Record<LLMTask, readonly string[]> = {
  fast:            [PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  conversation:    [PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  'structured-json':[PI_BANSOS_MODELS.cohere,  PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  long:            [PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.poolside],
  code:            [PI_BANSOS_MODELS.poolside, PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron],
};

export const MODELS = {
  structure: 'jr/gemini-3.1-pro' as const,
  structureAlt: 'bb/gpt-5.4' as const,
  summary: 'bb/claude-sonnet-4.6' as const,
} as const;

export interface CallLLMOpts {
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  endpoint?: string;
  jsonMode?: boolean;
}

export interface CallLLMResult {
  content: string | null;
  modelUsed: string | null;
  fallbacksTriggered: FallbackEvent[];
}

export async function callLLM(
  task: LLMTask,
  systemPrompt: string,
  userContent: string,
  opts: CallLLMOpts = {},
): Promise<CallLLMResult> {
  const maxTokens = opts.maxTokens ?? 4096;
  const timeout = opts.timeout ?? 120_000;
  const temperature = opts.temperature ?? 0.2;
  const endpoint = opts.endpoint ?? 'unknown';
  const jsonMode = opts.jsonMode ?? (task === 'structured-json' || task === 'long');
  const fallbacksTriggered: FallbackEvent[] = [];

  // ── PHASE 1: Polyvor (try phala GLM-5.3-Flash first, then DeepSeek V4) ─
  if (POLYVOR_API_KEY) {
    const polyvorModels = [POLYVOR_MODEL, POLYVOR_FALLBACK_MODEL];
    for (let pi = 0; pi < polyvorModels.length; pi++) {
      const polyvorModel = polyvorModels[pi];
      const t0 = Date.now();
      try {
        const requestBody: any = {
          model: polyvorModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature,
          max_tokens: maxTokens,
          stream: false,
        };
        if (jsonMode) requestBody.response_format = { type: 'json_object' };

        const res = await fetch(`${POLYVOR_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${POLYVOR_API_KEY}`,
          },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(timeout),
        });

        if (res.ok) {
          const data = await res.json() as any;
          const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || null;
          if (content) {
            const elapsedMs = Date.now() - t0;
            console.log(`[callLLM] ${endpoint} Polyvor/${polyvorModel} success (${elapsedMs}ms, ${data.usage?.total_tokens ?? '?'} tokens, jsonMode=${jsonMode})`);
            return { content, modelUsed: `polyvor/${polyvorModel}`, fallbacksTriggered };
          }
        }

        const errBody = await res.text().catch(() => '');
        const isConcurrency = res.status === 429 || errBody.includes('concurrency') || errBody.includes('rate_limit');
        const modelShort = polyvorModel.split('/').pop();
        const errorType = `Polyvor_${modelShort}_HTTP_${res.status}`;
        const errorMessage = errBody.slice(0, 200) || res.statusText;

        if (pi + 1 < polyvorModels.length) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: `polyvor/${polyvorModel}`,
            toModel: `polyvor/${polyvorModels[pi + 1]}`,
            task, errorType, errorMessage, endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} ${isConcurrency ? '429' : 'failed'} → retrying ${polyvorModels[pi + 1]}`);
          continue;
        }

        const event: FallbackEvent = {
          timestamp: new Date().toISOString(),
          fromModel: `polyvor/${polyvorModel}`,
          toModel: 'pi-bansos-chain',
          task, errorType, errorMessage, endpoint,
        };
        logFallbackEvent(event);
        fallbacksTriggered.push(event);
        console.warn(`[callLLM] ${endpoint} Polyvor all models failed → falling back to pi-bansos`);
      } catch (e: any) {
        const modelShort = polyvorModel.split('/').pop();
        const errorType = e?.name === 'TimeoutError' || e?.message?.includes('timeout') || e?.message?.includes('abort')
          ? `Polyvor_${modelShort}_Timeout` : `Polyvor_${modelShort}_NetworkError`;
        const errorMessage = (e?.message || 'unknown').slice(0, 200);

        if (pi + 1 < polyvorModels.length) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: `polyvor/${polyvorModel}`,
            toModel: `polyvor/${polyvorModels[pi + 1]}`,
            task, errorType, errorMessage, endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} ${errorType}: ${errorMessage} → retrying ${polyvorModels[pi + 1]}`);
          continue;
        }

        const event: FallbackEvent = {
          timestamp: new Date().toISOString(),
          fromModel: `polyvor/${polyvorModel}`,
          toModel: 'pi-bansos-chain',
          task, errorType, errorMessage, endpoint,
        };
        logFallbackEvent(event);
        fallbacksTriggered.push(event);
        console.warn(`[callLLM] ${endpoint} Polyvor ${errorType}: ${errorMessage} → falling back to pi-bansos`);
      }
    }
  } else {
    console.warn(`[callLLM] ${endpoint} POLYVOR_API_KEY not set — skipping Polyvor, using pi-bansos directly`);
  }

  // ── PHASE 2: pi-bansos fallback chain (Cohere → Nemotron → Poolside) ──
  const chain = TASK_MODEL_CHAIN[task];
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const t0 = Date.now();
    try {
      const requestBody: any = {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature,
        max_tokens: Math.min(maxTokens, 4000),
        stream: false,
      };
      if (jsonMode) requestBody.response_format = { type: 'json_object' };

      const res = await fetch(`${PI_BANSOS_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PI_BANSOS_KEY}`,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const errorType = `HTTP_${res.status}`;
        const errorMessage = errBody.slice(0, 200) || res.statusText;
        if (i + 1 < chain.length) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: model,
            toModel: chain[i + 1],
            task, errorType, errorMessage, endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} ${model} failed (${errorType}) → falling back to ${chain[i + 1]}`);
        }
        continue;
      }

      const data = await res.json() as any;
      const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || null;

      if (!content) {
        const errorType = 'EmptyContent';
        const errorMessage = JSON.stringify(data).slice(0, 200);
        if (i + 1 < chain.length) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: model,
            toModel: chain[i + 1],
            task, errorType, errorMessage, endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} ${model} empty content → falling back to ${chain[i + 1]}`);
        }
        continue;
      }

      const elapsedMs = Date.now() - t0;
      console.log(`[callLLM] ${endpoint} ${model} success (${elapsedMs}ms, ${data.usage?.total_tokens ?? '?'} tokens)${i > 0 ? ` after ${i} fallback` : ''}`);
      incrementUsage();
      return { content, modelUsed: model, fallbacksTriggered };
    } catch (e: any) {
      const errorType = e?.name === 'TimeoutError' || e?.message?.includes('timeout') || e?.message?.includes('abort')
        ? 'Timeout' : 'NetworkError';
      const errorMessage = (e?.message || 'unknown').slice(0, 200);
      if (i + 1 < chain.length) {
        const event: FallbackEvent = {
          timestamp: new Date().toISOString(),
          fromModel: model,
          toModel: chain[i + 1],
          task, errorType, errorMessage, endpoint,
        };
        logFallbackEvent(event);
        fallbacksTriggered.push(event);
        console.warn(`[callLLM] ${endpoint} ${model} ${errorType} → falling back to ${chain[i + 1]}`);
      }
      continue;
    }
  }

  console.error(`[callLLM] ${endpoint} all ${chain.length} pi-bansos models failed, trying CF relay fallback...`);

  // ── PHASE 3: CF WORKER RELAY FALLBACK ──
  for (const relayUrl of CF_RELAY_URLS) {
    const model = chain[0];
    try {
      const res = await fetch(`${relayUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${PI_BANSOS_KEY}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature,
          max_tokens: Math.min(maxTokens, 4000),
          stream: false,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (res.ok) {
        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning || null;
        if (content) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: 'pi-bansos-all-failed',
            toModel: `cf-relay/${model}`,
            task,
            errorType: 'PiBansosAllDown',
            errorMessage: `pi-bansos failed → CF relay ${relayUrl}`,
            endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          incrementUsage();
          console.warn(`[callLLM] ${endpoint} CF relay SUCCESS (${relayUrl}) with ${model}`);
          return { content, modelUsed: `cf-relay/${model}`, fallbacksTriggered };
        }
      }
    } catch (e: any) {
      console.warn(`[callLLM] ${endpoint} CF relay ${relayUrl} error:`, e?.message);
    }
  }

  return { content: null, modelUsed: null, fallbacksTriggered };
}

export async function callPolyvor(model: string, systemPrompt: string, userContent: string, opts?: { maxTokens?: number; timeout?: number }): Promise<string | null> {
  return (await callLLM('long', systemPrompt, userContent, {
    maxTokens: opts?.maxTokens ?? 4096,
    timeout: opts?.timeout ?? 120_000,
    endpoint: `callPolyvor/${model}`,
  })).content;
}

export function extractJson(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

export function extractMermaid(text: string): string {
  let cleaned = text.replace(/```(?:mermaid)?\s*/g, '').replace(/```/g, '').trim();
  if (cleaned.startsWith('mermaid')) cleaned = cleaned.slice(7).trim();
  const endIdx = cleaned.toLowerCase().indexOf('end subgraph');
  if (endIdx !== -1) cleaned = cleaned.slice(0, endIdx + 'end subgraph'.length);
  return cleaned;
}
