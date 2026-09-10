import type { APIRoute } from 'astro';

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
    const model = body.model || 'llama-3.3-70b-versatile';
    const temperature = body.temperature ?? 0.7;
    const maxTokens = body.max_tokens || 2048;

    if (!messages.length) {
      return Response.json({ error: 'messages required' }, { status: 400 });
    }

    // ===== Step 1: Try Groq first (fast, external) =====
    const apiKey = process.env.GROQ_API_KEY;
    if (apiKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30_000); // 30s timeout
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
        // If 429 (rate limit) or 5xx, fall through to Qwen
        console.log(`[ai/chat] Groq ${res.status}, falling back to Qwen...`);
      } catch (e) {
        console.log(`[ai/chat] Groq failed: ${e instanceof Error ? e.message : 'unknown'}, trying Qwen...`);
      }
    }

    // ===== Step 2: Fallback to Qwen local =====
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
      return Response.json(
        { error: `Qwen local error: ${res.status}` },
        { status: res.status }
      );
    } catch (e) {
      return Response.json(
        { error: 'Both Groq and Qwen failed', detail: e instanceof Error ? e.message : 'unknown' },
        { status: 503 }
      );
    }
  } catch (e) {
    return Response.json(
      { error: 'Internal error', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};
