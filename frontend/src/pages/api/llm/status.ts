import type { APIRoute } from 'astro';
import { getLatestHealth } from '@/lib/llm-health-log';

const PI_BANSOS_URL = process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1';

export const GET: APIRoute = async () => {
  const providers: any[] = [];

  // ── pi-bansos (PRIMARY — local proxy on VPS) ──
  // Live probe + cross-reference with latest health-check log
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

  // Cross-reference with last cron health-check (may have more accurate alive status)
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
    note: 'Free via KiloCode gateway. Fallback chain: Cohere → Nemotron → Poolside.',
  });

  // ── Groq (kept for Whisper audio + emergency fallback when pi-bansos down) ──
  if (process.env.GROQ_API_KEY) {
    providers.push({
      name: 'groq',
      type: 'external',
      model: 'qwen/qwen3.8-27b + whisper-large-v3-turbo',
      available: true,
      latency: 'fast',
      note: 'Used for audio transcription + emergency chat fallback when pi-bansos fails.',
    });
  }

  // ── Qwen local (legacy — still used as last-resort fallback in some endpoints) ──
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch('http://localhost:8000/llm/health', {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      providers.push({
        name: 'qwen-local',
        type: 'local',
        model: 'qwen2.5-3b-instruct',
        available: data.available === true,
        latency: 'slow',
        note: 'Legacy fallback. CPU-only, slow.',
      });
    }
  } catch {}

  // ── Polyvor Gateway (legacy — used by callPolyvor when pi-bansos fails) ──
  if (process.env.GATEWAY_API_KEY) {
    providers.push({
      name: 'polyvor-gateway',
      type: 'external',
      models: ['jr/gemini-3.1-pro', 'bb/gpt-5.4', 'bb/claude-sonnet-4.6', 'cx/gpt-5.6-sol'],
      available: true,
      latency: 'medium',
      note: 'Legacy fallback when pi-bansos fails. callPolyvor routes through this.',
    });
  }

  // ── Client-side WebLLM (browser-only fallback for chat) ──
  providers.push({
    name: 'webllm',
    type: 'client-side',
    model: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    available: 'browser-dependent',
    latency: 'fast-after-load',
    note: 'Loaded in browser, no server cost. Last-resort for chat.',
  });

  return Response.json({
    providers,
    recommended: piBansosAvailable ? 'pi-bansos' : 'groq',
  });
};
