import type { APIRoute } from 'astro';
import { callLLM, type LLMTask } from '@/lib/gateway-client';

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

    // ===== pi-bansos ONLY (no legacy fallback chains) =====
    // callLLM has internal fallback chain (Cohere → Nemotron → Poolside)
    // depending on task type. If all 3 pi-bansos models fail, return 503.
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';
    const userMsgs = messages.filter(m => m.role !== 'system');
    const userContent = userMsgs.map(m => `${m.role}: ${m.content}`).join('\n\n');

    const result = await callLLM(task, systemMsg, userContent, {
      maxTokens,
      timeout: 60_000,
      temperature,
      endpoint: 'ai/chat',
    });

    if (result.content) {
      return Response.json({
        id: `pi-bansos-${Date.now()}`,
        object: 'chat.completion',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        provider: 'pi-bansos',
        model: result.modelUsed,
        fallbacksTriggered: result.fallbacksTriggered.length,
      });
    }

    return Response.json(
      { error: 'pi-bansos sedang tidak tersedia (semua 3 model gagal). Coba lagi nanti.' },
      { status: 503 }
    );
  } catch (e) {
    return Response.json(
      { error: 'Internal error', detail: e instanceof Error ? e.message : 'unknown' },
      { status: 500 }
    );
  }
};
