/**
 * Shared LLM client for Lina Learning.
 *
 * Two helpers:
 *   - callLLM(task, system, user, opts)   — NEW (v-pi-bansos): routes to
 *     pi-bansos local proxy at 127.0.0.1:18080 with task-appropriate primary
 *     model + fallback chain (Poolside → Cohere → Nemotron or reverse).
 *     Logs fallback events to llm-health-log.ts for admin panel visibility.
 *   - callPolyvor(model, system, user, opts) — LEGACY: still calls Polyvor
 *     Gateway directly. Kept for endpoints we haven't migrated yet (e.g.
 *     structure-module Tier-1 still uses MODELS.structure = polyvor id).
 *
 * Migration plan (when API architecture stabilizes): switch callPolyvor
 * callers to callLLM, delete callPolyvor.
 */

import {
  logFallbackEvent,
  type FallbackEvent,
} from '@/lib/llm-health-log';

// ── pi-bansos local proxy config ──────────────────────────────────
// Proxy runs on VPS as PM2 process (port 18080). OpenAI-compatible.
const PI_BANSOS_URL = process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1';
const PI_BANSOS_KEY = 'placeholder'; // pi-bansos doesn't check auth header

// ── Model IDs (pi-bansos allowlist — 3 verified-working KiloCode models) ─
export const PI_BANSOS_MODELS = {
  // Fast, structured JSON, short text correction
  cohere: 'cohere/north-mini-code:free',
  // Long context (1M), strong reasoning, multi-step
  nemotron: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  // Code-specialized
  poolside: 'poolside/laguna-s-2.1:free',
} as const;

// Task type → primary model + fallback order.
// User spec: "Poolside error → retry Cohere; Cohere error → retry Nemotron".
// For code tasks we use Poolside first (specialized), fallback Cohere → Nemotron.
// For long/reasoning tasks we use Nemotron first, fallback Cohere → Poolside.
// For fast/JSON tasks we use Cohere first, fallback Nemotron → Poolside.
export type LLMTask = 'fast' | 'long' | 'code' | 'conversation' | 'structured-json';

const TASK_MODEL_CHAIN: Record<LLMTask, readonly string[]> = {
  fast:            [PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  conversation:    [PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  'structured-json':[PI_BANSOS_MODELS.cohere,  PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.poolside],
  long:            [PI_BANSOS_MODELS.nemotron, PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.poolside],
  code:            [PI_BANSOS_MODELS.poolside, PI_BANSOS_MODELS.cohere,   PI_BANSOS_MODELS.nemotron],
};

// ── LEGACY: Polyvor Gateway (kept for un-migrated endpoints) ──────
const GATEWAY_URL = 'https://gateway.polyvorlabs.com/v1/chat/completions';

// Model assignments per user spec — unchanged, still points at Polyvor IDs.
// (callLLM uses PI_BANSOS_MODELS instead — task-based routing.)
export const MODELS = {
  structure: 'jr/gemini-3.1-pro' as const,
  structureAlt: 'bb/gpt-5.4' as const,
  summary: 'bb/claude-sonnet-4.6' as const,
} as const;

const MAX_RETRIES = 2;
const RETRY_DELAYS = [5000, 15000]; // ms

// ── callLLM: pi-bansos with fallback chain ──────────────────────────
export interface CallLLMOpts {
  maxTokens?: number;
  timeout?: number;
  temperature?: number;
  /** Which call site is invoking this? Tagged on fallback events for admin panel */
  endpoint?: string;
}

export interface CallLLMResult {
  content: string | null;
  modelUsed: string | null;
  fallbacksTriggered: FallbackEvent[];
}

/**
 * callLLM — try primary model first, fall back to other 2 in chain on error.
 * Logs each fallback event to llm-health-log for admin panel visibility.
 *
 * Returns null content if ALL 3 models fail.
 */
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
  const chain = TASK_MODEL_CHAIN[task];
  const fallbacksTriggered: FallbackEvent[] = [];

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const isPrimary = i === 0;
    if (!isPrimary) {
      // We're in fallback territory — log that we're about to try this model
      // (actual event logged after we know the result of the previous attempt)
    }

    const t0 = Date.now();
    try {
      const res = await fetch(`${PI_BANSOS_URL}/chat/completions`, {
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
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (!res.ok) {
        const errBody = await res.text().catch(() => '');
        const errorType = `HTTP_${res.status}`;
        const errorMessage = errBody.slice(0, 200) || res.statusText;

        // Log fallback event (if there's a next model to try)
        if (i + 1 < chain.length) {
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: model,
            toModel: chain[i + 1],
            task,
            errorType,
            errorMessage,
            endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} ${model} failed (${errorType}) → falling back to ${chain[i + 1]}`);
        } else {
          console.error(`[callLLM] ${endpoint} ${model} failed (${errorType}) — no more fallbacks`);
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
            task,
            errorType,
            errorMessage,
            endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          console.warn(`[callLLM] ${endpoint} ${model} empty content → falling back to ${chain[i + 1]}`);
        }
        continue;
      }

      const elapsedMs = Date.now() - t0;
      console.log(`[callLLM] ${endpoint} ${model} success (${elapsedMs}ms, ${data.usage?.total_tokens ?? '?'} tokens)${i > 0 ? ` after ${i} fallback` : ''}`);
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
          task,
          errorType,
          errorMessage,
          endpoint,
        };
        logFallbackEvent(event);
        fallbacksTriggered.push(event);
        console.warn(`[callLLM] ${endpoint} ${model} ${errorType} → falling back to ${chain[i + 1]}`);
      } else {
        console.error(`[callLLM] ${endpoint} ${model} ${errorType}: ${errorMessage} — no more fallbacks`);
      }
      continue;
    }
  }

  console.error(`[callLLM] ${endpoint} all ${chain.length} models failed`);
  return { content: null, modelUsed: null, fallbacksTriggered };
}

// ── LEGACY: callPolyvor (still used by structure-module Tier-1) ────
export async function callPolyvor(model: string, systemPrompt: string, userContent: string, opts?: { maxTokens?: number; timeout?: number }): Promise<string | null> {
  const maxTokens = opts?.maxTokens ?? 4096;
  const timeout = opts?.timeout ?? 120_000;
  const key = process.env.GATEWAY_API_KEY || '';

  if (!key) {
    console.error('[gateway] No GATEWAY_API_KEY set');
    return null;
  }

  let lastError = '';

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS[attempt - 1] || 15000;
      console.log('[gateway] ' + model + ' retry ' + attempt + '/' + MAX_RETRIES + ', waiting ' + (delay/1000) + 's...');
      await new Promise(r => setTimeout(r, delay));
    }

    try {
      const res = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: AbortSignal.timeout(timeout),
      });

      if (res.status === 429) {
        lastError = 'Rate limited (429)';
        const errBody = await res.text().catch(() => '');
        console.error('[gateway] ' + model + ' HTTP 429: ' + errBody.slice(0, 100));
        continue; // retry
      }

      if (res.status === 401) {
        const errBody = await res.text().catch(() => '');
        console.error('[gateway] ' + model + ' HTTP 401: ' + errBody.slice(0, 100));
        return null; // don't retry auth errors
      }

      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || null;
        if (content) {
          console.log('[gateway] ' + model + ' success (' + (data.usage?.total_tokens ?? '?') + ' tokens)');
          return content;
        }
        lastError = 'Empty response content';
        console.error('[gateway] ' + model + ' empty content');
        continue;
      }

      const errBody = await res.text().catch(() => '');
      lastError = 'HTTP ' + res.status;
      console.error('[gateway] ' + model + ' HTTP ' + res.status + ': ' + errBody.slice(0, 150));
      return null;
    } catch (e: any) {
      lastError = e?.message || 'unknown';
      console.error('[gateway] ' + model + ' fail: ' + lastError);
      if (lastError.includes('timeout') || lastError.includes('abort')) return null;
      continue;
    }
  }

  console.error('[gateway] ' + model + ' all retries failed: ' + lastError);
  return null;
}

export function extractJson(text: string): string {
  const cb = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cb) return cb[1].trim();
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

export function extractMermaid(text: string): string {
  let cleaned = text.replace(/```(?:mermaid)?\s*/g, '').replace(/```/g, '').trim();
  if (!cleaned.startsWith('mindmap')) {
    const idx = cleaned.indexOf('mindmap');
    if (idx >= 0) cleaned = cleaned.slice(idx);
  }
  return cleaned;
}
