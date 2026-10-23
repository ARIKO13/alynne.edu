import type { APIRoute } from 'astro';
import { callLLM, type LLMTask } from '@/lib/gateway-client';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const QWEN_LOCAL = 'http://localhost:8000/llm/chat';
const QWEN_TIMEOUT_MS = 120_000; // 2 min - Qwen is slow on CPU

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const messages: ChatMessage[] = body.messages || [];
    const temperature = body.temperature ?? 0.7;
    const maxTokens = body.max_tokens || 2048;
    const task: LLMTask = body.task || 'conversation';

    if (!messages.length) {
      return Response.json({ error: 'messages required' }, { status: 400 });
    }

    // ===== Step 1: Try pi-bansos first (free, local proxy on VPS) =====
    // callLLM has internal fallback chain (Cohere → Nemotron → Poolside)
    // depending on task type. If all 3 fail, falls through to Groq below.
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role !== 'system');
    const userContent = userMsgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const piResult = await callLLM(task, systemMsg, userContent, {
      maxTokens,
      timeout: 60_000,
      temperature,
      endpoint: 'ai/chat',
    });

    if (piResult.content) {
      return Response.json({
        id: `pi-bansos-${Date.now()}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: piResult.content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        provider: 'pi-bansos',
        model: piResult.modelUsed,
        fallbacksTriggered: piResult.fallbacksTriggered.length,
      });
    }
    console.log(`[ai/chat] pi-bansos all 3 models failed, falling back to Groq...`);

    // ===== Step 2: Fallback to Groq (rate-limited, but available) =====
    const apiKey = process.env.GROQ_API_KEY;
    const model = body.model || 'qwen/qwen3.8-27b';
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          return Response.json({
            ...data,
            provider: 'groq',
          });
        }
        console.log(`[ai/chat] Groq ${res.status}, falling back to Qwen...`);
      } catch (e) {
        console.log(`[ai/chat] Groq failed: ${e instanceof Error ? e.message : 'unknown'}, trying Qwen...`);
      }
    }

    // ===== Step 3: Fallback to Qwen local =====
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);
      const res = await fetch(QWEN_LOCAL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        return Response.json({
          ...data,
          provider: 'qwen-local',
          model: 'qwen2.5-3b-instruct',
        });
      }
      console.log(`[ai/chat] Qwen local ${res.status}, trying Gateway...`);
    } catch (e) {
      console.log(`[ai/chat] Qwen failed: ${e instanceof Error ? e.message : 'unknown'}, trying Gateway...`);
    }

    // ===== Step 4: Last resort — Gateway API (Polyvor Labs) =====
    const gwKey = process.env.GATEWAY_API_KEY;
    if (gwKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000);
        const res = await fetch('https://gateway.polyvorlabs.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${gwKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ model: 'cx/gpt-5.6-sol', messages, temperature, max_tokens: maxTokens }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json();
          return Response.json({ ...data, provider: 'gateway' });
        }
        console.log(`[ai/chat] Gateway ${res.status}, all providers failed`);
      } catch (e) {
        console.log(`[ai/chat] Gateway failed: ${e instanceof Error ? e.message : 'unknown'}`);
      }
    }

    return Response.json(
      { error: 'Semua AI provider gagal (pi-bansos down, Groq rate-limited, Qwen offline, Gateway down). Coba lagi nanti.' },
      { status: 503 }
    );
  } catch (e) {
    return Response.json(
      { error: 'Internal error', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};
