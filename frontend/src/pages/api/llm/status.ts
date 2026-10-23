import type { APIRoute } from 'astro';
import { getLatestHealth } from '@/lib/llm-health-log';

const PI_BANSOS_URL = process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1';

export const GET: APIRoute = async () => {
  const providers: any[] = [];

  // ── pi-bansos (PRIMARY + ONLY LLM provider for chat/mindmap/flashcard/structure) ──
  let piBansosAvailable = false;
  let piBansosLatency = 'unknown';
  let piBansosModels: string[] = [];
  try {
    const t0 = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${PI_BANSOS_URL}/models`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json() as any;
      piBansosModels = (data.data || []).map((m: any) => m.id);
      piBansosAvailable = piBansosModels.length > 0;
      const elapsed = Date.now() - t0;
      piBansosLatency = elapsed < 500 ? 'fast' : elapsed < 2000 ? 'medium' : 'slow';
    }
  } catch {}

  // Cross-reference with last cron health-check
  const latestHealth = getLatestHealth();
  if (latestHealth) {
    piBansosAvailable = piBansosAvailable && latestHealth.proxyReachable;
  }

  providers.push({
    name: 'pi-bansos',
    type: 'local-proxy',
    url: PI_BANSOS_URL,
    models: piBansosModels,
    available: piBansosAvailable,
    latency: piBansosLatency,
    lastHealthCheck: latestHealth?.checkedAt,
    lastAliveCount: latestHealth?.models.filter(m => m.alive).length ?? 0,
    lastTotalModels: latestHealth?.models.length ?? 0,
    note: 'ONLY LLM provider. Free via KiloCode gateway. Internal fallback chain: Cohere → Nemotron → Poolside. Used for chat, mindmap, flashcard, STT enhance, structure-module, structure-fallback, structure-direct.',
  });

  // ── Whisper (audio transcription only — separate concern, NOT chat LLM) ──
  // Uses Groq Whisper. Not replaceable by pi-bansos (text-only chat models).
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'whisper-groq',
      type: 'external-audio',
      model: 'whisper-large-v3-turbo',
      available: true,
      latency: 'medium',
      note: 'Audio transcription ONLY. Not a chat LLM — pi-bansos cannot do audio→text.',
    });
  }

  // ── OCR vision (separate concern, NOT chat LLM) ──
  // Uses Polyvor vision models. Not replaceable by pi-bansos (text-only).
  if (process.env.GATEWAY_API_KEY) {
    providers.push({
      name: 'ocr-vision',
      type: 'external-vision',
      models: ['th/gemini-3.7-flash', 'th/mimo-v2.5:free', 'vy/nemotron-vision'],
      available: true,
      latency: 'medium',
      note: 'Vision-based OCR ONLY. Not a chat LLM — pi-bansos cannot do image→text.',
    });
  }

  // ── Client-side WebLLM (browser-only, optional fallback for chat) ──
  providers.push({
    name: 'webllm',
    type: 'client-side',
    model: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    available: 'browser-dependent',
    latency: 'fast-after-load',
    note: 'Loaded in browser, no server cost. Optional client-side chat fallback.',
  });

  return Response.json({
    providers,
    recommended: piBansosAvailable ? 'pi-bansos' : 'webllm',
  });
};
