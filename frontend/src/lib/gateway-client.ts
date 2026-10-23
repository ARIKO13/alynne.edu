/**
 * Shared LLM client for Lina Learning — pi-bansos primary + emergency fallback.
 *
 * Two helpers (both route to pi-bansos local proxy as primary):
 *   - callLLM(task, system, user, opts) — primary helper. Routes to
 *     pi-bansos local proxy at 127.0.0.1:18080 with task-appropriate primary
 *     model + fallback chain (Cohere → Nemotron → Poolside or reverse).
 *     If ALL 3 pi-bansos models fail, makes ONE emergency Polyvor Gateway
 *     call as ultimate safety net (so critical features like chat/mindmap/
 *     flashcard/structure don't error when pi-bansos is down).
 *     Logs fallback events to llm-health-log.ts for admin panel visibility.
 *   - callPolyvor(model, system, user, opts) — kept for backward-compat
 *     with structure-module.ts callers. Internally just delegates to
 *     callLLM('long'). The `model` arg is now just a label/tag — actual
 *     model selection is by task type.
 *
 * Architecture:
 *   NORMAL: pi-bansos (3-model chain) — 99% of traffic
 *   EMERGENCY: 1 Polyvor call — only when pi-bansos dies entirely
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

  console.error(`[callLLM] ${endpoint} all ${chain.length} pi-bansos models failed, trying emergency Polyvor fallback...`);

  // ── EMERGENCY FALLBACK: single Polyvor Gateway call (no retries, no chain) ──
  // User requirement: critical features (chat, mindmap, flashcard, structure)
  // must not error when pi-bansos dies entirely. ONE Polyvor call as ultimate
  // safety net. If this also fails, return null and caller handles the error.
  // We don't log this to fallback.jsonl (it's a different provider tier, not
  // an internal pi-bansos fallback) — but we do log to console for ops.
  const gwKey = process.env.GATEWAY_API_KEY;
  if (gwKey) {
    try {
      const t0 = Date.now();
      const res = await fetch('https://gateway.polyvorlabs.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gwKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Pick Polyvor model based on task type — match the pi-bansos task
          // mapping as closely as possible. cx/gpt-5.6-sol is a good general
          // default; cx/gpt-5.6-terra is the code variant.
          model: task === 'code' ? 'cx/gpt-5.6-terra' : 'cx/gpt-5.6-sol',
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

      if (res.ok) {
        const data = await res.json() as any;
        const content = data.choices?.[0]?.message?.content || null;
        if (content) {
          const elapsedMs = Date.now() - t0;
          console.warn(`[callLLM] ${endpoint} EMERGENCY Polyvor fallback SUCCESS (${elapsedMs}ms, ${data.usage?.total_tokens ?? '?'} tokens) — pi-bansos was down`);
          // Log as a fallback event for admin panel visibility
          const event: FallbackEvent = {
            timestamp: new Date().toISOString(),
            fromModel: 'pi-bansos-all-failed',
            toModel: task === 'code' ? 'cx/gpt-5.6-terra (polyvor)' : 'cx/gpt-5.6-sol (polyvor)',
            task,
            errorType: 'PiBansosAllDown',
            errorMessage: `All 3 pi-bansos models failed → emergency Polyvor call`,
            endpoint,
          };
          logFallbackEvent(event);
          fallbacksTriggered.push(event);
          return { content, modelUsed: `polyvor-emergency/${task}`, fallbacksTriggered };
        }
        console.error(`[callLLM] ${endpoint} emergency Polyvor: empty content`);
      } else {
        console.error(`[callLLM] ${endpoint} emergency Polyvor HTTP ${res.status}`);
      }
    } catch (e: any) {
      console.error(`[callLLM] ${endpoint} emergency Polyvor fetch failed:`, e?.message);
    }
  } else {
    console.error(`[callLLM] ${endpoint} no GATEWAY_API_KEY set — no emergency fallback available`);
  }

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
