/**
 * Shared LLM client for Lina Learning — pi-bansos only.
 *
 * Two helpers (both route to pi-bansos local proxy):
 *   - callLLM(task, system, user, opts) — primary helper. Routes to
 *     pi-bansos local proxy at 127.0.0.1:18080 with task-appropriate primary
 *     model + fallback chain (Cohere → Nemotron → Poolside or reverse).
 *     Logs fallback events to llm-health-log.ts for admin panel visibility.
 *   - callPolyvor(model, system, user, opts) — kept for backward-compat
 *     with structure-module.ts callers. Internally just delegates to
 *     callLLM('long'). The `model` arg is now just a label/tag — actual
 *     model selection is by task type.
 *
 * v-cleanup: removed all legacy fallback paths (Groq / Qwen local /
 * Polyvor Gateway). pi-bansos + its internal fallback chain is the ONLY
 * LLM path. If all 3 pi-bansos models fail, returns null — caller
 * handles null as needed.
 *
 * Note: OCR (vision) + Whisper (audio) endpoints still use their own
 * direct fetches — those need capabilities pi-bansos doesn't have.
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

// ── Task type → primary model + fallback order ────────────────────
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

// ── MODELS — kept as LABEL constants for backward-compat ──────────
// structure-module.ts calls `callPolyvor(MODELS.structure, ...)` etc.
// callPolyvor now ignores the model arg (delegates to callLLM), so these
// are just labels used in logs/endpoint-tag.
export const MODELS = {
  structure: 'jr/gemini-3.1-pro' as const,    // legacy label, used as endpoint tag
  structureAlt: 'bb/gpt-5.4' as const,         // legacy label
  summary: 'bb/claude-sonnet-4.6' as const,    // legacy label
} as const;

// ── callLLM options + result ──────────────────────────────────────
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
 * Returns null content if ALL 3 pi-bansos models fail (no legacy fallback).
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

// ── callPolyvor — PURE pi-bansos wrapper (legacy compat) ──────────
// v-cleanup: removed Polyvor Gateway fallback entirely. Now just delegates
// to callLLM('long'). Kept as a separate function for backward-compat with
// structure-module.ts callers (which pass MODELS.structure / MODELS.summary
// as the model arg — that arg is now just a label/tag, ignored at runtime).
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
  if (!cleaned.startsWith('mindmap')) {
    const idx = cleaned.indexOf('mindmap');
    if (idx >= 0) cleaned = cleaned.slice(idx);
  }
  return cleaned;
}
