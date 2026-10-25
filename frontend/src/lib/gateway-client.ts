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
  /**
   * v-hybrid (2026-10-25): Override model spesifik untuk Polyvor gateway.
   * Kalau diisi, callLLM cuma akan coba model ini (skip POLYVOR_MODEL/POLYVOR_FALLBACK
   * fallback chain + skip pi-bansos fallback). Dipakai di mega-generate.ts Phase 1
   * (DeepSeek untuk ringkas) dan Phase 2 (GLM untuk struktur).
   * Contoh: { model: 'phala/deepseek/deepseek-v4-flash-0731' } → cuma DeepSeek.
   */
  model?: string;
  /**
   * v-robust (2026-10-25): Fallback chain per-request. Kalau opts.model gagal
   * (timeout/error/parse-fail), coba tiap model di array ini secara berurutan.
   * Hanya aktif kalau opts.model diisi. Tujuan: hilangkan phase2_all_failed.
   * Contoh untuk Phase 1 (DeepSeek primary): ['phala/z-ai/glm-5.3-flash', 'jr/gemini-3.5-flash-lite']
   * Contoh untuk Phase 2 (GLM primary): ['phala/deepseek/deepseek-v4-flash-0731', 'jr/gemini-3.5-flash-lite']
   */
  fallbackModels?: string[];
}

/**
 * v-robust (2026-10-25): Unified JSON parser — tahan terhadap output kotor dari LLM.
 *
 * Strategi (3 lapis):
 * 1. Direct JSON.parse — kalau model balik JSON bersih, langsung sukses.
 * 2. Strip markdown fence ```json ... ``` — kalau model bungkus JSON di code block.
 * 3. Balanced-brace extraction — scan dari setiap `{` untuk nemuin JSON object yang valid.
 *    Handles: text sebelum JSON, nested objects, string dengan escape, multiple JSON candidates.
 *
 * Return: parsed object (any shape) atau null kalau semua strategi gagal.
 * Caller yang validasi struktur (e.g., cek modul.bab.length).
 *
 * Ganti SEMUA JSON.parse(response) di codebase dengan safeParseJson(content) supaya
 * error "Unexpected non-whitespace character" gak muncul lagi.
 */
export function safeParseJson(raw: string | null | undefined): any | null {
  if (!raw || typeof raw !== 'string') return null;

  // Trim whitespace di awal/akhir
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strategy 1: direct JSON.parse
  try {
    const result = JSON.parse(trimmed);
    if (result && typeof result === 'object') return result;
  } catch { /* continue to next strategy */ }

  // Strategy 2: strip markdown fence ```json ... ``` atau ``` ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const result = JSON.parse(fenceMatch[1].trim());
      if (result && typeof result === 'object') return result;
    } catch { /* continue */ }
    // Kalau fence ada tapi parse gagal, coba balanced-brace di dalam fence
    const inner = fenceMatch[1].trim();
    const balanced = extractBalancedObject(inner);
    if (balanced) return balanced;
  }

  // Strategy 3: balanced-brace extraction (handles text before/after JSON,
  // nested objects, string dengan escape character)
  return extractBalancedObject(trimmed);
}

/**
 * Helper: extract first valid JSON object dari text menggunakan balanced-brace matching.
 * Handles escape sequences (\\, \", dll) dan string literals dengan benar.
 */
function extractBalancedObject(text: string): any | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue;
    let depth = 1;
    let inString = false;
    let escape = false;
    for (let j = i + 1; j < text.length; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            const result = JSON.parse(text.slice(i, j + 1));
            if (result && typeof result === 'object') return result;
          } catch { break; }  // `{` ini bukan JSON valid, coba `{` berikutnya
        }
      }
    }
  }
  return null;
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
  // v-hybrid: kalau opts.model diisi, coba model itu + opts.fallbackModels (per-request fallback chain).
  // v-robust: per-request fallback eliminate phase2_all_failed — kalau GLM down, otomatis coba DeepSeek,
  // kalau DeepSeek down, coba gemini-3.5-flash-lite, dst.
  if (POLYVOR_API_KEY) {
    const polyvorModels = opts.model
      ? [opts.model, ...(opts.fallbackModels || [])]
      : [POLYVOR_MODEL, POLYVOR_FALLBACK_MODEL];
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

        // v-robust: kalau opts.model + opts.fallbackModels diisi (per-request fallback chain),
        // coba next model di chain sebelum return null.
        if (opts.model && pi + 1 < polyvorModels.length) {
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} ${errorType}: ${errorMessage.slice(0, 100)} → fallback ${polyvorModels[pi + 1]}`);
          continue;
        }
        // v-hybrid: kalau cuma opts.model (no fallbackModels), return null segera
        if (opts.model) {
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} (model locked, no fallback) failed: ${errorType} ${errorMessage}`);
          return { content: null, modelUsed: `polyvor/${polyvorModel}`, fallbacksTriggered };
        }

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

        // v-robust: per-request fallback chain. Kalau opts.model + opts.fallbackModels diisi,
        // coba next model sebelum return null.
        if (opts.model && pi + 1 < polyvorModels.length) {
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} ${errorType}: ${errorMessage.slice(0, 100)} → fallback ${polyvorModels[pi + 1]}`);
          continue;
        }
        // v-hybrid: kalau cuma opts.model (no fallbackModels), return null segera
        if (opts.model) {
          console.warn(`[callLLM] ${endpoint} Polyvor/${polyvorModel} (model locked, no fallback) ${errorType}: ${errorMessage}`);
          return { content: null, modelUsed: `polyvor/${polyvorModel}`, fallbacksTriggered };
        }

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
