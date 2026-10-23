import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { isAdmin } from '@/lib/admin';
import {
  getLatestHealth,
  getRecentFallbackEvents,
  getFallbackCount24h,
  recordHealthCheck,
  type HealthCheckResult,
  type ModelHealth,
} from '@/lib/llm-health-log';

const PI_BANSOS_URL = process.env.PI_BANSOS_URL || 'http://127.0.0.1:18080/v1';
const PI_BANSOS_KEY = 'placeholder';

// The 3 pi-bansos models we test
const TEST_MODELS = [
  { id: 'cohere/north-mini-code:free',         name: 'Cohere North Mini Code' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'NVIDIA Nemotron 3 Ultra' },
  { id: 'poolside/laguna-s-2.1:free',           name: 'Poolside Laguna S 2.1' },
];

const TEST_PROMPT = 'Reply with one short sentence: what model are you?';
const TEST_MAX_TOKENS = 80;
const TEST_TIMEOUT_MS = 30_000;

async function testSingleModel(modelId: string): Promise<ModelHealth> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${PI_BANSOS_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${PI_BANSOS_KEY}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: TEST_PROMPT }],
        max_tokens: TEST_MAX_TOKENS,
        stream: false,
      }),
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        modelId,
        alive: false,
        errorType: `HTTP_${res.status}`,
        errorMessage: errBody.slice(0, 150) || res.statusText,
        responseMs: Date.now() - t0,
      };
    }

    const data = await res.json() as any;
    const content = data.choices?.[0]?.message?.content
      || data.choices?.[0]?.message?.reasoning
      || '';

    if (!content) {
      return {
        modelId,
        alive: false,
        errorType: 'EmptyContent',
        errorMessage: 'Model returned 200 but no content',
        responseMs: Date.now() - t0,
      };
    }

    return {
      modelId,
      alive: true,
      replySnippet: String(content).slice(0, 80),
      responseMs: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      modelId,
      alive: false,
      errorType: e?.name === 'TimeoutError' || e?.message?.includes('timeout')
        ? 'Timeout'
        : 'NetworkError',
      errorMessage: (e?.message || 'unknown').slice(0, 150),
      responseMs: Date.now() - t0,
    };
  }
}

async function checkProxyReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${PI_BANSOS_URL}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function runHealthCheck(triggeredBy: 'cron' | 'manual'): Promise<HealthCheckResult> {
  const proxyReachable = await checkProxyReachable();
  // Run all 3 model tests in parallel (each has independent timeout)
  const models = await Promise.all(TEST_MODELS.map(m => testSingleModel(m.id)));
  const result: HealthCheckResult = {
    checkedAt: new Date().toISOString(),
    triggeredBy,
    proxyReachable,
    models,
  };
  recordHealthCheck(result);
  return result;
}

// ── GET: fetch latest health + recent fallback events ──────────────
export const GET: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const latest = getLatestHealth();
    const fallbackEvents = getRecentFallbackEvents(50);
    const fallbackCount24h = getFallbackCount24h();

    return Response.json({
      latest,
      fallbackEvents,
      fallbackCount24h,
      piBansosUrl: PI_BANSOS_URL,
    });
  } catch (e) {
    console.error('[admin/llm-health] GET error:', e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};

// ── POST: trigger a manual health check ────────────────────────────
export const POST: APIRoute = async ({ request }) => {
  try {
    const session = await getSession(request);
    if (!session?.user?.email || !isAdmin(session.user.email)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await runHealthCheck('manual');
    return Response.json({ result });
  } catch (e) {
    console.error('[admin/llm-health] POST error:', e);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
};

// ── Exported for use by cron script ─────────────────────────────────
// (scripts/run-health-check.ts imports this directly to bypass HTTP/auth)
export { runHealthCheck };
