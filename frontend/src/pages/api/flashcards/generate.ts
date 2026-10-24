import type { APIRoute } from 'astro';
import { getSession } from '@/lib/auth';
import { callLLM, extractJson } from '@/lib/gateway-client';

/**
 * POST /api/flashcards/generate
 *
 * Request body:
 *   { title: string, content: string, maxCards?: number }
 *
 * Response:
 *   200: { cards: [{ front, back }], modelUsed, fallbacksTriggered }
 *   400: { error: 'Missing title or content' }
 *   401: { error: 'Unauthorized' }   — requires logged-in user (any user, not admin)
 *   500: { error: 'Generation failed' }
 *
 * Server-side endpoint that:
 *   1. Auth-checks the session (any logged-in user — flashcards are user-facing)
 *   2. Calls callLLM('structured-json', ...) which routes to pi-bansos local
 *      proxy with Cohere primary + fallback chain (Cohere → Nemotron → Poolside)
 *   3. Parses JSON response, returns { front, back } pairs
 *
 * Browser-side FlashcardPanel calls this; if response is empty/error,
 * falls back to local algorithmic generator (in flashcard-system.ts).
 */

const MAX_CONTENT_CHARS = 8000;
const MAX_CARDS = 12;

const SYSTEM_PROMPT = `You are a flashcard generator for Indonesian educational content. Given chapter text, create high-quality Q&A flashcards that test the most important concepts.

Output STRICT JSON only. No prose. No markdown fences. No explanations.
Format: {"cards":[{"front":"question","back":"answer"}]}

Rules:
- 8-10 cards total
- Front: concise question (max 15 words, Indonesian)
- Back: concise answer (max 30 words, Indonesian)
- Cover: definitions, key facts, "why", "how", examples
- Avoid yes/no questions — prefer "what", "why", "how"
- Vary question type: definition, factual, conceptual
- Skip if chapter is too short (< 3 sentences)`;

export const POST: APIRoute = async ({ request }) => {
  try {
    // Auth: any logged-in user can use this (flashcards are user-facing)
    const session = await getSession(request);
    if (!session?.user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json() as { title?: string; content?: string; maxCards?: number };
    const title = (body.title || '').trim().slice(0, 200);
    const content = (body.content || '').slice(0, MAX_CONTENT_CHARS);

    if (!content || content.length < 50) {
      return Response.json({ error: 'Missing or too-short content' }, { status: 400 });
    }

    const maxCards = Math.min(MAX_CARDS, Math.max(3, body.maxCards ?? 10));

    const userPrompt = `Bab: ${title || '(tanpa judul)'}

Content:
${content}

Generate ${maxCards} flashcards as JSON.`;

    const result = await callLLM('structured-json', SYSTEM_PROMPT, userPrompt, {
      maxTokens: 2048,
      timeout: 60_000,
      endpoint: 'flashcards/generate',
    });

    if (!result.content) {
      console.error('[flashcards/generate] callLLM returned null (all models failed)');
      return Response.json({
        cards: [],
        error: 'All models failed',
        fallbacksTriggered: result.fallbacksTriggered,
      }, { status: 200 });  // 200 with empty cards — client falls back to algorithmic
    }

    // Extract JSON from response (LLM may wrap in ```json fences)
    const jsonStr = extractJson(result.content);
    let parsed: { cards?: { front?: string; back?: string }[] } = {};
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Try regex extract as last resort
      const match = jsonStr.match(/"cards"\s*:\s*\[([\s\S]*?)\]/);
      if (match) {
        try {
          parsed = JSON.parse('{"cards":[' + match[1] + ']}');
        } catch { /* leave parsed = {} */ }
      }
    }

    const cards = (parsed.cards || [])
      .slice(0, maxCards)
      .map(c => ({
        front: String(c.front || '').trim().slice(0, 300),
        back: String(c.back || '').trim().slice(0, 600),
      }))
      .filter(c => c.front && c.back);

    console.log(`[flashcards/generate] ${cards.length} cards generated (model: ${result.modelUsed}, fallbacks: ${result.fallbacksTriggered.length})`);

    return Response.json({
      cards,
      modelUsed: result.modelUsed,
      fallbacksTriggered: result.fallbacksTriggered.length,
    });
  } catch (e: any) {
    console.error('[flashcards/generate] fatal:', e);
    return Response.json({ error: 'Generation failed', message: e?.message }, { status: 500 });
  }
};
